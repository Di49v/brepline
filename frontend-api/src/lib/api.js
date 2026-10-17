import { BASE_URL } from "./config.js";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Pull the first three "N mm"-style numbers out of a prompt for a believable demo response. */
function guessDims(prompt, units) {
  const nums = [...prompt.matchAll(/(\d+(?:\.\d+)?)\s*(?:mm|cm|in)?/g)].map((m) => parseFloat(m[1]));
  const [x = 60, y = 40, z = 40] = nums;
  return { x, y, z, units };
}

/**
 * Calls POST /generate. In demo mode no network request is made, so the
 * playground works before your backend is wired up.
 */
export async function generate({ apiKey, demo, ...body }) {
  const started = performance.now();

  if (demo) {
    await wait(1100 + Math.random() * 700);
    const id = "gen_" + Math.random().toString(16).slice(2, 10);
    return {
      status: 200,
      ms: Math.round(performance.now() - started),
      data: {
        id,
        object: "generation",
        status: "complete",
        download_url: `https://files.brepline.com/${id}.${body.format}`,
        preview_url: `https://files.brepline.com/${id}.png`,
        format: body.format,
        dimensions: guessDims(body.prompt, body.units),
        material: body.material,
        credits_used: 1,
        created_at: new Date().toISOString(),
      },
    };
  }

  const res = await fetch(`${BASE_URL}/generate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let data;
  try {
    data = await res.json();
  } catch {
    data = { error: { type: "invalid_response", message: "Response was not valid JSON." } };
  }
  return { status: res.status, ms: Math.round(performance.now() - started), data };
}
