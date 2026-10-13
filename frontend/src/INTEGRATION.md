# Wiring the React frontend to the backend

**Update:** a complete, ready-to-use `App.jsx` is now included in this folder. Easiest path: copy `App.jsx`, `api.js`, `MeshViewer.jsx` into `src/` and add the `.env` (steps 1 below). Steps 2-6 explain what changed inside it. `Viewer3D.jsx` is no longer imported (App.jsx has its own real-mesh viewer modal) and can be deleted.

I did not edit your `App.jsx` directly (it was pasted into the chat, not on this machine), so these are the exact changes to make. All of them are small and local.

## 1. Copy files and set env

```
cp api.js MeshViewer.jsx  <your-project>/src/
```
`.env` in the frontend project:
```
VITE_API_URL=http://localhost:7860          # or https://<user>-<space>.hf.space
VITE_ACCESS_CODE=                           # same value as backend ACCESS_CODE (if set)
```
Backend `ALLOWED_ORIGINS` must contain your site origin (e.g. `http://localhost:5173`).

## 2. Replace the fake `gen()` with the real call

In `App.jsx`:
```jsx
import { generate, vote as sendVote, fileUrl } from "./api";
import MeshViewer from "./MeshViewer";
```
Where `send()` / `regen()` currently call `gen(M, k)` inside `setTimeout`, replace with:
```jsx
const [log, setLog] = useState([]);
async function run(prompt, { parentJob = null, fresh = false } = {}) {
  setBusy(true); setLog([]);
  try {
    const r = await generate({ prompt, material: M, parentJob, fresh }, setLog);
    // store r in the same place the fake result was stored (history entry / current result)
    addResult(r);        // r.job, r.mesh, r.mass_g, r.bbox, r.code, r.warning, r.verified
  } catch (e) {
    addError(e.message); // show as an assistant error bubble
  } finally { setBusy(false); }
}
```
* **Edit / follow-up** ("make the hole bigger"): `run(text, { parentJob: lastResult.job })`
* **Regenerate**: `run(prompt, { fresh: true })` (skips the cache)
* While `busy`, render `log[log.length-1]` as the status line ("planning", "generating 3 candidates", "repair round 1"...).

## 3. Result card

Remove the fake numbers. Use real ones:
* Mass: `r.mass_g` (volume x density of the selected material; this is geometry only, not FEA)
* Size: `r.bbox` -> `${bbox.join(" × ")} mm`
* **Delete "Safety factor" and "Run FEA"** (nothing in the backend computes them; showing them would be fake data).
* Show `r.warning` if present (e.g. size mismatch / disconnected parts) and a "verified" badge when `r.verified`.
* Downloads: `<a href={fileUrl(r.job,"step")}>STEP</a>`, `"stl"`, `"py"` (CadQuery source).

## 4. Viewer

Replace the hardcoded bracket / FACES renderer with:
```jsx
<MeshViewer mesh={r.mesh} bbox={r.bbox} />
```
Remove the hardcoded "100 × 70 × 60 mm" footer (MeshViewer prints the real one).

## 5. Votes

Your thumbs-up/down handler: `sendVote(r.job, "up" | "down")` (fire-and-forget). Down-voted jobs are excluded from training exports.

## 6. History

Keep your local `hist` state, but store `{prompt, job}` per entry. Past jobs can be re-opened with `GET /api/jobs/{job}` while the backend still has the files (default 24 h on free hosting; the storage dir is ephemeral on HF Spaces).

## 7. Custom polygon / profile editor (new)

Copy `ShapeEditor.jsx` next to `App.jsx` and use the new `api.js` (adds `buildShape`, `validateShape`).
If you already changed your own `App.jsx`, add just these pieces:

```jsx
import ShapeEditor from './ShapeEditor.jsx'

// inside App():
const [shapeEd, setShapeEd] = useState({ open: false, initial: null, parent: null })
const drawShape = () => setShapeEd({ open: true, initial: null, parent: null })
const editShape = v => setShapeEd({ open: true, initial: v.shape, parent: v.job })
const closeShape = useCallback(() => setShapeEd(s => ({ ...s, open: false })), [])
const addShapeResult = (r, spec, name) => { /* add a chat message exactly like runGen does:
   const v = toVersion(r, name || 'Custom polygon part', fmt, mat) */ }

// toVersion(): add   shape: (r.plan && r.plan.profile_spec) || null,  checkNote: r.check_detail || ''
// composer bar:      <button className="btn" onClick={drawShape}>Draw shape</button>
// result card:       {v.shape && <button className="btn" onClick={() => editShape(v)}>Edit shape</button>}
// at the end of the JSX:
<ShapeEditor open={shapeEd.open} initial={shapeEd.initial} material={mat}
             parentJob={shapeEd.parent} onClose={closeShape} onResult={addShapeResult} />
```
The editor only needs the CSS variables and `.btn` classes you already have. The complete `App.jsx` in this
folder already contains all of it.
