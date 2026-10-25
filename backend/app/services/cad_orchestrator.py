import logging
from typing import TypedDict, Dict, Any, Optional, List
from langgraph.graph import StateGraph, END
from app.services.llm import LLMService
from app.services.physics_engine import PhysicsEngine, MATERIAL_DENSITIES_G_CM3
from app.services.assembler import CadAssembler
from app.sandbox.executor import SandboxExecutor
from app.db.repository import CadRepository
from app.core.config import settings

logger = logging.getLogger(__name__)

CANONICAL_ARCHETYPES = {
    "cylindrical_tube",
    "ogive_cone",
    "conical_frustum",
    "radial_fin_set",
    "spur_gear",
    "flanged_plate",
    "l_bracket",
    "enclosure_box",
    "wheel_set",
    "tubular_frame",
    "contoured_body",
    "custom_part",
}


class CadGraphState(TypedDict):
    job_id: str
    raw_prompt: str
    material: str
    fresh: bool
    parent_job: Optional[str]
    expanded_prompt: Optional[str]
    bom_json: Optional[Dict[str, Any]]
    # Iterative Sub-Part Queue State
    part_queue: List[Dict[str, Any]]
    current_part: Optional[Dict[str, Any]]
    current_part_index: int
    total_parts: int
    cache_matches: Optional[List[Dict[str, Any]]]
    current_part_code: Optional[str]
    current_part_cached: bool
    part_repair_attempts: int
    compiled_parts: Dict[str, Dict[str, Any]]
    # Live UI Streaming Fields
    progress_log: Optional[str]
    latest_part_mesh: Optional[Dict[str, Any]]
    # Master Assembly & Audit State
    cad_code: Optional[str]
    cached_hit: bool
    error_traceback: Optional[str]
    repair_attempts: int
    physics_report: Optional[Dict[str, Any]]
    final_result: Optional[Dict[str, Any]]


class CadOrchestrator:
    def __init__(self):
        self.llm = LLMService()
        self.sandbox = SandboxExecutor()
        self.repo = CadRepository()
        self.graph = self._build_graph()

    def _build_graph(self):
        """
        Constructs the Iterative Sub-Part LangGraph State Machine:
        intent_analyzer -> specifier -> subpart_router -> (modifier | atomic_coder) -> part_compiler
             ^                                                                              |
             |_______________________ (next part in part_queue) ____________________________|
                                                                                            v
                                                                                  assembler_and_auditor -> END
        """
        workflow = StateGraph(CadGraphState)

        workflow.add_node("intent_analyzer", self.node_intent_analyzer)
        workflow.add_node("specifier", self.node_specifier)
        workflow.add_node("subpart_router", self.node_subpart_router)
        workflow.add_node("modifier", self.node_modifier)
        workflow.add_node("atomic_coder", self.node_atomic_coder)
        workflow.add_node("part_compiler", self.node_part_compiler)
        workflow.add_node("auditor", self.node_auditor)

        workflow.set_entry_point("intent_analyzer")
        workflow.add_edge("intent_analyzer", "specifier")
        workflow.add_edge("specifier", "subpart_router")

        # Route each sub-part to Agent 2A (modifier) or Agent 2B (atomic_coder)
        workflow.add_conditional_edges(
            "subpart_router",
            self.route_coder_strategy,
            {
                "modify": "modifier",
                "create": "atomic_coder",
            }
        )

        workflow.add_edge("modifier", "part_compiler")
        workflow.add_edge("atomic_coder", "part_compiler")

        # After compiling a sub-part: repair it, move to next sub-part, or finish at auditor
        workflow.add_conditional_edges(
            "part_compiler",
            self.route_part_compiler_output,
            {
                "repair_part": "atomic_coder",
                "next_part": "subpart_router",
                "assemble": "auditor",
                "fatal": END,
            }
        )

        workflow.add_edge("auditor", END)
        return workflow.compile()

    # --- Conditional Routers ---

    def route_coder_strategy(self, state: CadGraphState) -> str:
        """
        Dual-Gate Archetype Router:
        1. If the cached row has the SAME `archetype_tag` (e.g. 'ogive_cone', 'l_bracket', 'radial_fin_set'),
           route to `modifier` at similarity >= 0.76!
        2. Otherwise, require similarity >= 0.86.
        """
        if state.get("fresh") or state.get("error_traceback"):
            return "create"

        matches = state.get("cache_matches") or []
        if not matches:
            return "create"

        best = matches[0]
        sim = float(best.get("similarity") or 0.0)
        part = state.get("current_part") or {}
        target_tag = str(part.get("archetype_tag") or "").lower().strip()
        cached_tags = [str(t).lower().strip() for t in (best.get("tags") or [])]

        # Gate 1: Exact whole-object match (>= 0.86) or matching archetype tag (>= 0.76)
        same_archetype = bool(target_tag and target_tag in cached_tags)
        if (same_archetype and sim >= 0.76) or sim >= 0.86:
            logger.info(
                f"Cache HIT (sim={sim:.2f}, archetype={target_tag}, tags={cached_tags}). "
                f"Routing to Agent 2A (modifier)."
            )
            return "modify"

        logger.info(f"Cache MISS (sim={sim:.2f}, target_tag={target_tag}). Routing to Agent 2B (atomic_coder).")
        return "create"
    
    def route_part_compiler_output(self, state: CadGraphState) -> str:
        """Routes sub-part compilation result: repair current part, pop next part, or assemble."""
        if state.get("error_traceback"):
            if state.get("part_repair_attempts", 0) < 2:
                return "repair_part"
            # If a secondary sub-part failed after 2 repair attempts but we already have compiled parts,
            # skip the broken sub-part and assemble what we have rather than failing the whole job!
            if state.get("compiled_parts"):
                logger.warning("Skipping failed secondary sub-part after 2 repair attempts; continuing queue.")
                if state.get("part_queue"):
                    return "next_part"
                return "assemble"
            return "fatal"

        if state.get("part_queue"):
            return "next_part"
        return "assemble"

    # --- Node Implementations ---

    async def node_intent_analyzer(self, state: CadGraphState) -> Dict[str, Any]:
        """Agent 0: Expands sparse prompts into clean, contoured 3D CAD geometry specs."""
        sys_prompt = (
            "You are Agent 0: Industrial CAD Architect. Expand the user's CAD prompt into "
            "a clear, material-agnostic geometric specification in millimeters.\n"
            "COORDINATE SYSTEM: +X is Front/Forward, +Y is Left/Right (Wheel Axle Axis), +Z is Up.\n"
            "CRITICAL GEOMETRIC RULES:\n"
            "1. Remove specific material names (e.g., Al 6061, PLA).\n"
            "2. NEVER specify skeletal parts (frames, forks, swingarms, handlebars, legs) as large (L x W x H) bounding boxes! "
            "Specify them as tubular cylinders/struts with actual tube diameters (e.g., 25mm-40mm tube OD) so they don't become giant solid bricks.\n"
            "3. For contoured bodies (car bodies, fuel tanks, seats, fairings), specify their 2D side-profile silhouette in the XZ plane "
            "(with key (X, Z) polygon vertices) extruded symmetrically along Y, rather than rectangular boxes.\n"
            "4. For wheels, specify outer tire diameter, rim/hub recess diameter, width along the Y-axis axle, and exact (X, Y, Z) center coordinates.\n"
            "5. Keep major bodies as water-tight solids without fragile .shell() operations.\n"
            "Output ONLY the concise expanded geometric specification."
        )
        expanded = await self.llm.generate(
            [
                {"role": "system", "content": sys_prompt},
                {"role": "user", "content": state["raw_prompt"]}
            ],
            temperature=0.2,
            max_tokens=2048,
            role="intent"
        )
        return {
            "expanded_prompt": expanded.strip(),
            "progress_log": "planning geometry & physics constraints"
        }
        
    async def node_specifier(self, state: CadGraphState) -> Dict[str, Any]:
        """
        Agent 1: Decomposes specification into 1 to 4 functional sub-assemblies
        with universal topological archetypes, realistic per-part materials, and hex colors.
        """
        sys_prompt = (
            "You are Agent 1: Chief Mechanical Decomposer. Convert the geometric specification into a strict JSON BOM.\n"
            "CRITICAL DECOMPOSITION RULES:\n"
            "1. For single mechanical parts (e.g., bracket, spur gear, flange, washer, enclosure, bolt), set `is_assembly: false` "
            "and output EXACTLY 1 part in `parts` with `position_mm: [0, 0, 0]`.\n"
            "2. For multi-component vehicles/machines (e.g., rocket, car, motorcycle, drone), set `is_assembly: true` "
            "and decompose into 2 to 4 major functional sub-assemblies (MAX 4 parts! Group symmetric arrays like 'all 4 wheels' or 'all 4 fins' into a SINGLE part entry!).\n"
            "3. Each part MUST include:\n"
            "   - `id`: short snake_case name (e.g., 'chassis_body', 'cabin_glass', 'wheel_set', 'nose_cone', 'fuselage_body', 'fin_set').\n"
            "   - `archetype_tag`: choose ONE canonical shape family from: "
            "['cylindrical_tube', 'ogive_cone', 'conical_frustum', 'radial_fin_set', 'spur_gear', 'flanged_plate', 'l_bracket', 'enclosure_box', 'wheel_set', 'tubular_frame', 'contoured_body', 'custom_part'].\n"
            "   - `archetype_query`: MUST start with `<archetype_tag>: ` followed by a standardized, material-agnostic description of the shape and its key dimensions in mm.\n"
            "   - `dimensions`: dictionary of ALL numeric dimensions AND hole/cutout features in mm.\n"
            "   - `position_mm`: [X, Y, Z] world translation offset where this sub-part's local (0,0,0) origin sits in the final assembly.\n"
            "   - `default_material`: choose realistic material for this sub-part from ['Al 6061', 'Steel', 'Titanium', 'Carbon Fiber', 'Brass', 'Copper', 'Glass', 'Rubber', 'PLA', 'ABS'] "
            "(e.g., 'Glass' for windows/windshields/canopies, 'Rubber' for tires/wheels, 'Steel' or 'Al 6061' for body/chassis, 'Titanium' for nose cones/nozzles).\n"
            "   - `color_hex`: realistic hex color for 3D rendering (e.g., '#38bdf8' sky-blue for glass/windows, '#ef4444' crimson red for car body/fins, '#1e293b' dark charcoal for rubber tires, '#cbd5e1' silver for fuselage/metal).\n"
            "Output ONLY valid JSON matching:\n"
            "{\n"
            "  \"object\": \"short 2-4 word name\",\n"
            "  \"is_assembly\": true,\n"
            "  \"canonical_query\": \"full object description\",\n"
            "  \"parts\": [\n"
            "    {\"id\": \"main_body\", \"archetype_tag\": \"l_bracket\", \"archetype_query\": \"l_bracket: ...\", \"dimensions\": {}, \"position_mm\": [0, 0, 0], \"default_material\": \"Al 6061\", \"color_hex\": \"#94a3b8\"}\n"
            "  ],\n"
            "  \"shared_interfaces\": {}\n"
            "}"
        )
        raw_json = await self.llm.generate(
            [
                {"role": "system", "content": sys_prompt},
                {"role": "user", "content": state["expanded_prompt"] or state["raw_prompt"]}
            ],
            temperature=0.1,
            max_tokens=4096,
            role="planner"
        )
        bom = self.llm.extract_json(raw_json)
        parts_list = bom.get("parts") or []

        # Fallback if LLM returned empty parts array
        if not parts_list:
            parts_list = [{
                "id": "main_body",
                "archetype_tag": "custom_part",
                "archetype_query": bom.get("canonical_query") or state.get("expanded_prompt") or state["raw_prompt"],
                "dimensions": {},
                "position_mm": [0.0, 0.0, 0.0],
                "default_material": state.get("material", "Al 6061"),
                "color_hex": "#94a3b8"
            }]
            bom["parts"] = parts_list

        # Cap at 4 functional sub-assemblies to guarantee fast build times
        parts_list = parts_list[:4]
        bom["parts"] = parts_list

        part_names = ", ".join(p.get("id", f"part_{i+1}") for i, p in enumerate(parts_list))
        return {
            "bom_json": bom,
            "part_queue": list(parts_list),
            "total_parts": len(parts_list),
            "current_part_index": 0,
            "compiled_parts": {},
            "progress_log": f"decomposed into {len(parts_list)} component(s): {part_names}"
        }

    async def node_subpart_router(self, state: CadGraphState) -> Dict[str, Any]:
        """Pops the next sub-part from `part_queue` and performs pgvector archetype lookup."""
        queue = list(state.get("part_queue") or [])
        if not queue:
            return {"current_part": None, "cache_matches": []}

        current_part = queue.pop(0)
        idx = state.get("current_part_index", 0) + 1
        total = state.get("total_parts", 1)
        pid = current_part.get("id", f"part_{idx}")
        atag = current_part.get("archetype_tag", "custom_part")

        # Build search query: if single-part job, use full canonical_query; if sub-part, use archetype_query
        bom = state.get("bom_json") or {}
        if total == 1:
            query = bom.get("canonical_query") or current_part.get("archetype_query") or state.get("expanded_prompt") or state["raw_prompt"]
        else:
            raw_aq = current_part.get("archetype_query") or f"{pid} {current_part.get('dimensions', {})}"
            query = raw_aq if raw_aq.startswith(atag) else f"{atag}: {raw_aq}"
            current_part["archetype_query"] = query

        matches: List[Dict[str, Any]] = []
        if not state.get("fresh"):
            try:
                embedding = await self.llm.get_embedding(query)
                matches = self.repo.search_similar_cad(embedding, threshold=0.68, limit=3)
            except Exception as e:
                logger.warning(f"Sub-part vector lookup skipped for {pid}: {e}")

        return {
            "part_queue": queue,
            "current_part": current_part,
            "current_part_index": idx,
            "cache_matches": matches,
            "part_repair_attempts": 0,
            "error_traceback": None,
            "progress_log": f"building component ({idx}/{total}): {pid} [{ current_part.get('default_material', state.get('material', 'Al 6061')) }]"
        }

    async def node_modifier(self, state: CadGraphState) -> Dict[str, Any]:
        """Agent 2A: Surgical Parametric Modifier for a matched sub-part or template."""
        matches = state.get("cache_matches") or []
        best_match = matches[0]
        part = state.get("current_part") or {}
        pid = part.get("id", "main_body")
        idx = state.get("current_part_index", 1)
        total = state.get("total_parts", 1)

        logger.info(f"[{idx}/{total}] Cache HIT ({best_match['similarity']:.2f}) for '{pid}'. Running Agent 2A.")
        sys_prompt = (
            "You are Agent 2A: Parametric CAD Modifier. You are given a verified CadQuery script from cache.\n"
            "CRITICAL RULES:\n"
            "1. Update all numeric dimensions (length, width, height, thickness, radius) to match the Target Specification.\n"
            "2. Check if the Target Specification requires any holes, bores, or cutouts (e.g., mounting holes in the base) "
            "that are missing from the cached template, and add them cleanly.\n"
            "3. Keep the final `result = ...` assignment intact on the last line.\n"
            "Output ONLY valid Python code inside a ```python ``` block."
        )
        context_spec = state["raw_prompt"] if total == 1 else f"{part.get('archetype_query')} | {part.get('dimensions')}"
        user_content = (
            f"User Request: {context_spec}\n"
            f"Target Sub-Part BOM:\n{part}\n\n"
            f"Cached Template Code:\n```python\n{best_match['code']}\n```"
        )

        raw_code = await self.llm.generate(
            [{"role": "system", "content": sys_prompt}, {"role": "user", "content": user_content}],
            temperature=0.1,
            max_tokens=8192,
            role="modifier"
        )
        extracted = self.llm.extract_code(raw_code) or best_match["code"]
        return {
            "current_part_code": extracted,
            "current_part_cached": True,
            "cached_hit": state.get("cached_hit", False) or True,
            "progress_log": f"adapted {pid} ({idx}/{total}) from pgvector cache"
        }
        
    async def node_atomic_coder(self, state: CadGraphState) -> Dict[str, Any]:
        """Agent 2B: Generates origin-centered CadQuery code for `current_part`."""
        part = state.get("current_part") or {}
        pid = part.get("id", "main_body")
        idx = state.get("current_part_index", 1)
        total = state.get("total_parts", 1)
        matches = state.get("cache_matches") or []
        bom = state.get("bom_json") or {}

        logger.info(f"[{idx}/{total}] Executing Agent 2B (Atomic Coder) for sub-part '{pid}'.")

        sys_prompt = (
            "You are Agent 2B: Expert OpenCASCADE and CadQuery Engineer. Output ONLY valid Python code inside a ```python ``` block.\n"
            "COORDINATE CONVENTION: +X = Forward/Length, +Y = Left/Right Width (Axle Axis), +Z = Up/Height.\n"
            "CRITICAL CAD MODELING RULES:\n"
            "1. Always `import cadquery as cq` and `import math`.\n"
            "2. Pre-loaded helpers available in global namespace (do NOT redefine or import them):\n"
            "   - `spur_gear(m, z, t, bore=0)` -> returns a cq.Workplane spur gear\n"
            "   - `radial(shape, n, r=0)` -> copies `shape` n times around Z axis and unions them\n"
            "   - `bolt_circle(body, n, r, d, face='>Z')` -> drills n through-holes of diameter d on radius r\n"
            "3. BUILD ONLY THE REQUESTED COMPONENT AROUND LOCAL ORIGIN (0, 0, 0):\n"
            "   - Do NOT apply the assembly's world `position_mm` translation inside this script; the Master Assembler will translate it later.\n"
            "   - Exception: if building a symmetric pair/array (like `wheel_set` or `fin_set`), place the wheels/fins at their relative offsets around (0,0,0) and union them into `result`.\n"
            "4. NO BOXY BRICKS FOR VEHICLES/ASSEMBLIES:\n"
            "   - For car bodies, fuel tanks, seats, or fairings, sketch a 2D side silhouette on `cq.Workplane('XZ').polyline([...]).close().extrude(width/2, both=True)`.\n"
            "   - For frames, forks, handlebars, and struts, use cylinders/tubes (radius 12-25mm), NOT huge bounding boxes.\n"
            "   - For wheels, sketch on `cq.Workplane('XZ').circle(r_tire).extrude(width/2, both=True)` so the axle runs along Y.\n"
            "5. Avoid `.shell()` or fragile `.fillet()` on complex intersections. Assign the final solid to `result` on the last line."
        )

        if total == 1:
            spec_text = state.get("expanded_prompt") or state["raw_prompt"]
            user_content = (
                f"Create a complete CadQuery model centered at origin (0,0,0). Units: mm.\n"
                f"Specification: {spec_text}\n"
                f"Part Details: {part}\n"
            )
        else:
            user_content = (
                f"Build ONLY sub-component `{pid}` (part {idx} of {total} for `{bom.get('object', 'assembly')}`).\n"
                f"Build it centered at local origin (0, 0, 0) (do NOT apply world offset {part.get('position_mm')} yet).\n"
                f"Sub-Part Archetype & Description: {part.get('archetype_query')}\n"
                f"Target Dimensions (mm): {part.get('dimensions')}\n"
                f"Full Assembly Context (for mating reference only): {state.get('expanded_prompt')}\n"
            )

        if matches:
            user_content += "\nReference CadQuery Examples:\n"
            for m in matches[:1]:
                user_content += f"- {m['prompt']}\n```python\n{m['code']}\n```\n"

        if state.get("error_traceback"):
            user_content += (
                f"\nPREVIOUS CODE FOR `{pid}`:\n```python\n{state.get('current_part_code', '')}\n```\n"
                f"FAILED WITH ERROR:\n{state['error_traceback']}\n"
                f"Fix the CadQuery code for `{pid}` and ensure `result` is defined at the end."
            )

        raw_code = await self.llm.generate(
            [{"role": "system", "content": sys_prompt}, {"role": "user", "content": user_content}],
            temperature=0.2,
            max_tokens=12288,
            role="coder"
        )
        return {
            "current_part_code": self.llm.extract_code(raw_code),
            "current_part_cached": False
        }

    async def node_part_compiler(self, state: CadGraphState) -> Dict[str, Any]:
        """
        Agent 3: Compiles `current_part_code` in isolation, caches verified sub-parts
        into Supabase `cad_examples`, and streams intermediate 3D preview mesh.
        """
        part = state.get("current_part") or {}
        pid = part.get("id", "main_body")
        idx = state.get("current_part_index", 1)
        total = state.get("total_parts", 1)
        code = state.get("current_part_code") or ""

        if not code.strip():
            attempts = state.get("part_repair_attempts", 0) + 1
            return {
                "error_traceback": f"Coder returned empty code block for sub-part `{pid}`.",
                "part_repair_attempts": attempts,
                "repair_attempts": state.get("repair_attempts", 0) + 1,
                "progress_log": f"repairing {pid} (round {attempts})"
            }

        # Execute in a dedicated sub-folder for this sub-part (or main folder if 1 part)
        wd = f"{settings.out_dir}/{state['job_id']}" if total == 1 else f"{settings.out_dir}/{state['job_id']}/sub_{pid}"
        exec_result = await self.sandbox.run_code(code, wd)

        if not exec_result.get("ok"):
            attempts = state.get("part_repair_attempts", 0) + 1
            err_msg = exec_result.get("error", "Unknown runtime error")
            short_err = err_msg.strip().splitlines()[-1][:90] if err_msg else "runtime error"
            return {
                "error_traceback": err_msg,
                "part_repair_attempts": attempts,
                "repair_attempts": state.get("repair_attempts", 0) + 1,
                "progress_log": f"repairing {pid} (round {attempts}): {short_err}"
            }

        # Verified Sub-Part! Auto-cache this sub-part into `public.cad_examples` if it was freshly generated
        archetype_tag = str(part.get("archetype_tag") or "custom_part").strip()
        archetype_query = part.get("archetype_query") or f"{archetype_tag}: {pid} {part.get('dimensions', {})}"

        if not state.get("current_part_cached") and exec_result.get("valid", True):
            try:
                emb = await self.llm.get_embedding(archetype_query)
                self.repo.save_example_to_cache(
                    tags=[archetype_tag, "subpart", pid],
                    prompt=archetype_query,
                    code=code,
                    embedding=emb
                )
            except Exception as e:
                logger.warning(f"Sub-part cache save skipped for {pid}: {e}")

        compiled = dict(state.get("compiled_parts") or {})
        mat_name = part.get("default_material") or state.get("material", "Al 6061")
        default_hex = PhysicsEngine.get_material(mat_name).get("color_hex", "#94a3b8")
        compiled[pid] = {
            "code": code,
            "volume_mm3": float(exec_result.get("volume") or 0.0),
            "bbox": exec_result.get("bbox") or [0.0, 0.0, 0.0],
            "bbox_min": exec_result.get("bbox_min") or [0.0, 0.0, 0.0],
            "translate_mm": part.get("position_mm") or [0.0, 0.0, 0.0],
            "material": mat_name,
            "color_hex": part.get("color_hex") or default_hex,
            "archetype_tag": archetype_tag,
            "exec_result": exec_result,
        }

        return {
            "error_traceback": None,
            "compiled_parts": compiled,
            "latest_part_mesh": exec_result.get("mesh"),
            "progress_log": f"verified {pid} ({idx}/{total}) · cached [{archetype_tag}]"
        }

    async def node_auditor(self, state: CadGraphState) -> Dict[str, Any]:
        """
        Agent 4: Master Assembler & Multi-Physics Edge-Case Simulator.
        Stitches all verified sub-parts into the final assembly, compiles the master
        STEP/STL/mesh, and executes the analytical physics & material optimization audit.
        """
        compiled_parts = state.get("compiled_parts") or {}
        bom = state.get("bom_json") or {}
        bom_parts = bom.get("parts") or []
        mat = state.get("material", "Al 6061")

        # If single part, reuse its already-compiled result directly without re-running sandbox!
        if len(compiled_parts) == 1:
            only_id, only_data = next(iter(compiled_parts.items()))
            pos = only_data.get("translate_mm") or [0.0, 0.0, 0.0]
            if pos == [0.0, 0.0, 0.0] or pos == [0, 0, 0]:
                master_code = only_data["code"]
                res = only_data["exec_result"]
            else:
                master_code = CadAssembler.stitch_assembly(compiled_parts, bom_parts)
                wd = f"{settings.out_dir}/{state['job_id']}"
                res = await self.sandbox.run_code(master_code, wd)
        else:
            master_code = CadAssembler.stitch_assembly(compiled_parts, bom_parts)
            wd = f"{settings.out_dir}/{state['job_id']}"
            res = await self.sandbox.run_code(master_code, wd)

            # Fallback if stitched union had an issue: use the largest verified sub-part
            if not res.get("ok") and compiled_parts:
                largest_id = max(compiled_parts, key=lambda k: compiled_parts[k].get("volume_mm3", 0.0))
                master_code = compiled_parts[largest_id]["code"]
                res = compiled_parts[largest_id]["exec_result"]
                
        # Attach per-part color_hex and material metadata into physics_report so MeshViewer can color each part!
        part_colors = {pid: pdata.get("color_hex", "#94a3b8") for pid, pdata in compiled_parts.items()}
        part_materials = {pid: pdata.get("material", mat) for pid, pdata in compiled_parts.items()}
        report["part_colors"] = part_colors
        report["part_materials"] = part_materials

        vol_mm3 = float(res.get("volume") or 0.0)
        bbox = res.get("bbox") or [100.0, 100.0, 100.0]
        n_solids = res.get("n_solids") or (res.get("counts") or {}).get("solids", 1)
        has_named_parts = bool((res.get("mesh") or {}).get("parts")) or len(compiled_parts) > 1

        # Run First-Principles Physics & Crash/Wind/Buckling Audit
        report = PhysicsEngine.run_full_audit(
            volume_mm3=vol_mm3,
            bbox=bbox,
            material=mat,
            n_solids=n_solids,
            has_named_parts=has_named_parts,
            valid=bool(res.get("valid", True)),
            compiled_parts=compiled_parts,
        )

        canonical_query = bom.get("canonical_query") or state.get("expanded_prompt") or state["raw_prompt"]

        # Persist completed generation to Supabase `generations` table
        self.repo.save_generation({
            "job": state["job_id"],
            "prompt": state["raw_prompt"],
            "material": mat,
            "route": "cache_modifier" if state.get("cached_hit") else "iterative_assembly",
            "parent_job": state.get("parent_job"),
            "plan": bom,
            "code": master_code,
            "ok": True,
            "verified": report["verified"],
            "score": 10 if report["verified"] else 8,
            "bbox": bbox,
            "volume_mm3": report["volume_mm3"],
            "mass_g": report["mass_g"],
            "physics": report,
            "attempts": state.get("repair_attempts", 0) + 1,
            "llm_model": settings.coder_model
        })

        # Also cache the complete stitched assembly under its canonical query if multi-part
        if len(compiled_parts) > 1 and report["verified"] and master_code:
            try:
                emb = await self.llm.get_embedding(canonical_query)
                self.repo.save_example_to_cache(
                    tags=[bom.get("object", "assembly"), "assembly"],
                    prompt=canonical_query,
                    code=master_code,
                    embedding=emb
                )
            except Exception as e:
                logger.warning(f"Master assembly cache save skipped: {e}")

        return {
            "cad_code": master_code,
            "final_result": res,
            "physics_report": report,
            "progress_log": f"done · safety factor {report['overall_safety_factor']}x"
        }

    async def execute_job(
        self,
        job_id: str,
        prompt: str,
        material: str = "Al 6061",
        fresh: bool = False,
        parent_job: Optional[str] = None
    ) -> Dict[str, Any]:
        """Direct non-streaming entry point for CLI scripts and Pytest suites."""
        initial_state: CadGraphState = {
            "job_id": job_id,
            "raw_prompt": prompt,
            "material": material,
            "fresh": fresh,
            "parent_job": parent_job,
            "expanded_prompt": None,
            "bom_json": None,
            "part_queue": [],
            "current_part": None,
            "current_part_index": 0,
            "total_parts": 1,
            "cache_matches": None,
            "current_part_code": None,
            "current_part_cached": False,
            "part_repair_attempts": 0,
            "compiled_parts": {},
            "progress_log": None,
            "latest_part_mesh": None,
            "cad_code": None,
            "cached_hit": False,
            "error_traceback": None,
            "repair_attempts": 0,
            "physics_report": None,
            "final_result": None
        }
        return await self.graph.ainvoke(initial_state)