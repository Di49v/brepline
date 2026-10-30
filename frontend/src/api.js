// src/api.js -- talks to the Brepline backend.
const BASE = (import.meta.env.VITE_API_URL || "http://localhost:7860").replace(/\/$/, "");
const CODE = import.meta.env.VITE_ACCESS_CODE || "";
const H = { "Content-Type": "application/json", "X-Access-Code": CODE };

export const fileUrl = (job, ext) => `${BASE}/api/file/${job}/${ext}`; // ext: step | stl | py

async function j(res) {
  if (!res.ok) {
    let m = res.statusText;
    try { m = (await res.json()).detail || m; } catch {}
    throw new Error(m);
  }
  return res.json();
}

/**
 * generate({prompt, material, parentJob, fresh}, onLog) -> result object
 * result: {job, ok, code, mass_g, volume_mm3, bbox:[x,y,z], n_solids, score, verified,
 *          warning, mesh:{verts:[x,y,z,...], tris:[i,j,k,...]}}
 * Throws Error(message) on failure. onLog(lines[]) is called while polling.
 */
export async function generate(
  { prompt, material = "Al 6061", parentJob = null, fresh = false },
  onLog,
  signal,
  onJob,
  onPartialMesh
) {
  const { job } = await j(await fetch(`${BASE}/api/jobs`, {
    method: "POST",
    headers: H,
    signal,
    body: JSON.stringify({ prompt, material, parent_job: parentJob, fresh }),
  }));
  onJob && onJob(job); // lets the UI call cancelJob(job) when the user presses Stop
  return poll(job, onLog, signal, onPartialMesh);
}

// sleep that wakes up immediately when the request is aborted (so Stop reacts at once)
const sleep = (ms, signal) => new Promise((res, rej) => {
  if (signal && signal.aborted) return rej(new DOMException("Aborted", "AbortError"));
  const onAbort = () => { clearTimeout(t); rej(new DOMException("Aborted", "AbortError")); };
  const t = setTimeout(() => { signal && signal.removeEventListener("abort", onAbort); res(); }, ms);
  signal && signal.addEventListener("abort", onAbort, { once: true });
});

/** Best-effort: ask the server to stop a running job. Needs a matching route on the backend
 *  (DELETE /api/jobs/{job}); if the route does not exist this silently does nothing and the
 *  UI simply stops waiting for the result. */
export const cancelJob = job =>
  fetch(`${BASE}/api/jobs/${job}`, { method: "DELETE", headers: H }).catch(() => {});

/**
 * Polls `/api/jobs/{job}` until the backend finishes or errors.
 * Never times out on the client side while the backend job is actively "running" or "queued".
 */
async function poll(job, onLog, signal, onPartialMesh) {
  let consecutiveNetErrors = 0;
  while (true) {
    await sleep(1500, signal);
    try {
      const s = await j(await fetch(`${BASE}/api/jobs/${job}`, { signal }));
      consecutiveNetErrors = 0;
      onLog && onLog(s.log || []);
      if (s.partial_mesh && s.partial_mesh.verts && s.partial_mesh.verts.length && onPartialMesh) {
        onPartialMesh(s.partial_mesh);
      }
      if (s.status === "done") return s.result;
      if (s.status === "error") throw new Error(s.error || "generation failed");
    } catch (err) {
      if (signal && signal.aborted) throw err;
      if (err && err.message && !/fetch|network/i.test(err.message)) throw err;
      consecutiveNetErrors += 1;
      if (consecutiveNetErrors > 10) throw err;
    }
  }
}

/**
 * buildShape({spec, name, material, parentJob}, onLog) -> same result object as generate()
 * spec = {type:"polygon", points:[[x,y]..], thickness, holes:[{x,y,d}], cutouts:[[[x,y]..]]}
 *      | {type:"revolve", profile:[[r,z]..], radial:[{count, polygon:[[r,z]..], thickness}]}
 * No AI involved: the backend builds exactly the polygon you drew (fast, exact).
 */
export async function buildShape({ spec, name = "", material = "Al 6061", parentJob = null }, onLog, signal) {
  const { job } = await j(await fetch(`${BASE}/api/shape`, {
    method: "POST",
    headers: H,
    signal,
    body: JSON.stringify({ spec, name, material, parent_job: parentJob }),
  }));
  return poll(job, onLog, signal);
}

/**
 * Interactive Physics & Crash Lab API: recalculates crash crumple depth, peak G,
 * crosswind bending stress, and per-part material savings in <10ms.
 */
export async function simulatePhysics(
  job,
  { material = "Al 6061", speed_kmh = 64, wind_m_s = 45, obstacle = "concrete_wall", part_materials = null, age_years = 0, temp_c = 25, humidity_pct = 50 }
) {
  return j(await fetch(`${BASE}/api/jobs/${job}/simulate`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ material, speed_kmh, wind_m_s, obstacle, part_materials, age_years, temp_c, humidity_pct }),
  }));
}

export const fetchHistory = () =>
  fetch(`${BASE}/api/history`, { headers: H })
    .then(r => (r.ok ? r.json() : { ok: false, items: [] }))
    .catch(() => ({ ok: false, items: [] }));

export const validateShape = (spec, signal) =>
  fetch(`${BASE}/api/shape/validate`, { method: "POST", headers: H, signal, body: JSON.stringify({ spec }) })
    .then(r => r.json());

export const vote = (job, v, comment = "") =>
  fetch(`${BASE}/api/feedback`, { method: "POST", headers: H, body: JSON.stringify({ job, vote: v, comment }) })
    .catch(() => {});

export const health = () => fetch(`${BASE}/api/health`).then(r => r.json());