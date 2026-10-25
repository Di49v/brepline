# Brepline Master Architecture & Implementation Roadmap

## 1. Core System Vision
Brepline is an Agentic Text-to-CAD & First-Principles Physics Simulation Platform.
Unlike mesh-only generative tools, Brepline generates 100% parametric OpenCASCADE B-Rep solids (`CadQuery`), decomposes complex assemblies into reusable sub-parts cached in `Supabase pgvector`, streams sub-part builds live to the UI, and runs analytical structural/aerodynamic/crash stress simulations with real-time 3D visual deformation.

---

## 2. Multi-Key LLM Pool (`backend/app/services/llm.py` & `config.py`)
- **Problem:** Single free-tier API keys hit RPM (15 req/min) and TPM (16K tokens/min) limits during multi-part assembly loops.
- **Solution:**
  - Support comma-separated key pools in `.env`: `GEMINI_API_KEYS` and `GROQ_API_KEYS`.
  - Initialize an `itertools.cycle` pool of `AsyncOpenAI` clients per provider.
  - Each `generate()` call pulls the next client in the ring (`0ms` delay).
  - On `429 RateLimitError`, `500 InternalError`, or `APITimeoutError`, immediately rotate to the next key/provider in a single pass (`no retry sleep on congested endpoints`).
  - Strip `<thought>...</thought>` and `<think>...</think>` blocks via regex (`re.S | re.I`), convert stray markdown bullets/LaTeX (`$`) inside code fences to `#` comments, and reject truncated code (`finish_reason == "length"`).

---

## 3. Iterative Sub-Part Assembly Pipeline (`backend/app/services/cad_orchestrator.py`)

### State Schema (`CadGraphState`)
- `job_id`, `raw_prompt`, `material`, `fresh`, `parent_job`
- `expanded_prompt`: Clean geometric spec (+X forward, +Y left/right axle, +Z up).
- `load_context`: Operating physics regime (`axial_g`, `crosswind_m_s`, `impact_v_m_s`).
- `bom_json`: Master plan with `is_assembly` and `parts` list (capped at max 4–5 functional sub-assemblies; symmetric arrays like 4 wheels or 4 fins are grouped as 1 sub-assembly).
- `part_queue`: Remaining sub-parts to build.
- `current_part`: Sub-part currently being processed (`part_id`, `archetype_tag`, `archetype_query`, `dimensions`, `translate_mm`, `default_material`, `load_role`).
- `current_part_matches`: `pgvector` matches for `current_part`.
- `compiled_parts`: Dict mapping `part_id -> {code, volume_mm3, bbox, bbox_min, material, verified}`.
- `cad_code`: Final stitched master Python script defining both `parts = {...}` and `result = ...`.
- `final_result`: Output from `runner.py` (including `mesh.json` with `verts`, `tris`, `parts`, `tri_part`).
- `physics_report`: Output from `physics_engine.py` (per-part safety factors, crash/wind/buckling metrics, lightweighting recommendations).

### LangGraph Node Responsibilities
1. **`intent_analyzer` (Agent 0):**
   - Expands prompt into a material-agnostic coordinate spec (`+X` forward, `+Y` axle, `+Z` up).
   - Enforces sculptural CAD laws: 2D XZ side-silhouette extrusions for bodies/tanks/fairings, tubular cylinders for frames/forks/struts, XZ-plane wheels extruded along Y.
2. **`specifier` (Agent 1 - BOM & Archetype Planner):**
   - Decomposes geometry into 1 to 5 functional sub-parts.
   - Assigns each part a strict `archetype_tag` (e.g., `cylindrical_tube`, `ogive_cone`, `trapezoidal_fin_array`, `spur_gear`, `l_bracket`, `wheel_set`, `contoured_body`) and a material-agnostic `archetype_query` centered at local origin `(0,0,0)`.
   - Initializes `part_queue`.
3. **`subpart_router` (Queue Manager & Dual-Gate Cache Lookup):**
   - Pops the next unbuilt part from `part_queue` into `current_part`.
   - Queries `pgvector` using `current_part["archetype_query"]`.
   - **Dual-Gate Rule:** Routes to `modifier` (Agent 2A) ONLY if `similarity >= 0.88` AND `archetype_tag` matches. Otherwise routes to `atomic_coder` (Agent 2B).
4. **`modifier` (Agent 2A - Fast Parametric Adapter):**
   - Adapts numeric parameters of the verified archetype script to match `current_part["dimensions"]`.
5. **`atomic_coder` (Agent 2B - Origin-Centered Sub-Part Coder):**
   - Generates a short, self-contained CadQuery script for `current_part` centered at `(0,0,0)` with `result` assigned.
6. **`part_compiler` (Agent 3 - Sub-Part Sandbox & Progressive Streamer):**
   - Compiles `current_part` in `runner.py`.
   - If error and `part_repair_attempts < 2`: routes back to `atomic_coder` with traceback.
   - If valid:
     - Auto-caches the verified sub-part into `public.cad_examples` with `tags=[archetype_tag, "subpart"]`.
     - Stores part in `compiled_parts[part_id]`.
     - Streams live progress log + intermediate `partial_mesh` to `JOB_STATES[job_id]` so the user sees the sub-part appear on screen immediately.
   - Loops back to `subpart_router` until `part_queue` is empty.
7. **`assembler_and_auditor` (Agent 4 - Master Stitcher & Physics Simulator):**
   - Uses `assembler.py` to encapsulate each `compiled_parts[part_id]` in its own function `def _build_<part_id>():`, applies `.translate(translate_mm)`, builds `parts = {...}` and `result = ...`, and compiles the final assembly.
   - Runs `physics_engine.py` across 4 edge cases:
     1. Frontal/Obstacle Crash Impact (Peak G, Crumple Zone Depth, Energy Absorption vs. Concrete Wall / Pole).
     2. Diagonal Crosswind Shear & Cantilever Bending Stress.
     3. Axial G-Load Euler Buckling.
     4. Per-Part Material Wastage & Lightweighting Optimizer.
   - If any critical sub-part has `Safety Factor < 1.2` (and `physics_repaired == False`), scales its thickness parameter and re-runs `part_compiler` once to guarantee a structurally sound final model.

---

## 4. Frontend Interactive Playground (`App.jsx` & `MeshViewer.jsx`)
1. **Live Sub-Part Build Preview:** Displays intermediate 3D mesh and step-by-step part checklist inside `<Thinking />` during generation.
2. **Per-Part Material & Color Inspector:** Uses `mesh.parts` and `mesh.tri_part` to color-code distinct sub-parts and allow per-part material swaps.
3. **Interactive Crash & Stress Simulation Tab in `MeshModal`:**
   - Controls: Impact Velocity (`10–200 km/h`), Wind Shear (`0–150 m/s`), Material Override, and Obstacle Preset (`Concrete Wall`, `Center Bollard Pole`, `Wind/Thrust Tunnel`).
   - Real-time 60 FPS vertex deformation + Stress Heatmap (`Green -> Yellow -> Red`) + telemetry cards (`Safety Factor`, `Peak G`, `Crumple Depth mm`, `Mass Saved kg`).