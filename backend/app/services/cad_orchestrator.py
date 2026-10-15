import logging
from typing import TypedDict, Dict, Any, Optional, List
from langgraph.graph import StateGraph, END
from app.services.llm import LLMService
from app.sandbox.executor import SandboxExecutor
from app.db.repository import CadRepository
from app.core.config import settings

logger = logging.getLogger(__name__)

MATERIAL_DENSITIES_G_CM3 = {
    "Al 6061": 2.70,
    "Steel": 7.85,
    "Titanium": 4.43,
    "Brass": 8.50,
    "Copper": 8.96,
    "PLA": 1.24,
    "ABS": 1.04,
}

class CadGraphState(TypedDict):
    job_id: str
    raw_prompt: str
    material: str
    fresh: bool
    parent_job: Optional[str]
    expanded_prompt: Optional[str]
    bom_json: Optional[Dict[str, Any]]
    cache_matches: Optional[List[Dict[str, Any]]]
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
        """Constructs the LangGraph state machine with separate Modifier and Atomic Coder nodes."""
        workflow = StateGraph(CadGraphState)

        # Add Nodes (Agents)
        workflow.add_node("intent_analyzer", self.node_intent_analyzer)
        workflow.add_node("specifier", self.node_specifier)
        workflow.add_node("modifier", self.node_modifier)          # Agent 2A (Cache Hit >= 0.85)
        workflow.add_node("atomic_coder", self.node_atomic_coder)  # Agent 2B (Cache Miss / Repair)
        workflow.add_node("compiler", self.node_compiler)
        workflow.add_node("auditor", self.node_auditor)

        # Define Edges (Routing)
        workflow.set_entry_point("intent_analyzer")
        workflow.add_edge("intent_analyzer", "specifier")

        # Conditional Routing from Specifier -> Modifier (2A) vs Atomic Coder (2B)
        workflow.add_conditional_edges(
            "specifier",
            self.route_coder_strategy,
            {
                "modify": "modifier",
                "create": "atomic_coder"
            }
        )

        workflow.add_edge("modifier", "compiler")
        workflow.add_edge("atomic_coder", "compiler")

        # Conditional Routing from Compiler (Repair always routes to atomic_coder)
        workflow.add_conditional_edges(
            "compiler",
            self.route_compiler_output,
            {
                "repair": "atomic_coder",
                "success": "auditor",
                "fatal": END
            }
        )
        workflow.add_edge("auditor", END)

        return workflow.compile()

    def route_coder_strategy(self, state: CadGraphState) -> str:
        """Pure synchronous router: inspects pre-fetched cache_matches from node_specifier."""
        if state.get("fresh") or state.get("error_traceback"):
            return "create"

        matches = state.get("cache_matches") or []
        if matches and matches[0].get("similarity", 0.0) >= 0.85:
            logger.info(
                f"High similarity cache hit ({matches[0]['similarity']:.2f}). "
                f"Routing to Agent 2A (modifier)."
            )
            return "modify"

        logger.info("Cache miss (or similarity < 0.85). Routing to Agent 2B (atomic_coder).")
        return "create"

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
        return {"expanded_prompt": expanded.strip()}
    
    async def node_specifier(self, state: CadGraphState) -> Dict[str, Any]:
        """Agent 1: Decomposes prompt into a structured BOM and queries pgvector semantic cache."""
        sys_prompt = (
            "You are Agent 1: Chief Mechanical Decomposer. Convert the geometric specification into a strict JSON object:\n"
            "{\n"
            "  \"object\": \"short 2-4 word part name (no material names)\",\n"
            "  \"is_assembly\": true or false,\n"
            "  \"canonical_query\": \"standardized material-agnostic description of the geometry and dimensions for vector cache lookup\",\n"
            "  \"parts\": [\n"
            "    {\"id\": \"part_name\", \"type\": \"primitive_or_feature\", \"dimensions\": {}, \"position_mm\": [0, 0, 0]}\n"
            "  ],\n"
            "  \"shared_interfaces\": {}\n"
            "}\n"
            "Output ONLY valid JSON."
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

        # Pre-fetch pgvector semantic matches here so route_coder_strategy can route cleanly
        matches: List[Dict[str, Any]] = []
        if not state.get("fresh"):
            canonical_query = bom.get("canonical_query") or state.get("expanded_prompt") or state["raw_prompt"]
            try:
                embedding = await self.llm.get_embedding(canonical_query)
                matches = self.repo.search_similar_cad(embedding, threshold=0.70, limit=2)
            except Exception as e:
                logger.warning(f"Vector cache lookup skipped: {e}")

        return {"bom_json": bom, "cache_matches": matches}

    async def node_modifier(self, state: CadGraphState) -> Dict[str, Any]:
        """Agent 2A: Surgical Parametric Modifier (High-Confidence Cache Hit >= 0.85)."""
        matches = state.get("cache_matches") or []
        best_match = matches[0]
        bom = state.get("bom_json") or {}
        canonical_query = bom.get("canonical_query") or state.get("expanded_prompt") or state["raw_prompt"]

        logger.info(f"Cache HIT ({best_match['similarity']:.2f}) on '{canonical_query}'. Executing Agent 2A (Modifier).")
        sys_prompt = (
            "You are Agent 2A: Parametric CAD Modifier. You are given a verified CadQuery script from cache. "
            "If the Target BOM dimensions match the template, return the template code UNCHANGED. "
            "If any dimensions differ, update ONLY those numeric parameters. "
            "Do NOT alter the structural logic or function signatures. "
            "CRITICAL: Keep the final `result` (or `parts`) assignment intact. Output ONLY valid Python code."
        )
        user_content = (
            f"Target BOM:\n{bom}\n\n"
            f"Cached Template Code:\n```python\n{best_match['code']}\n```"
        )

        raw_code = await self.llm.generate(
            [{"role": "system", "content": sys_prompt}, {"role": "user", "content": user_content}],
            temperature=0.1,
            max_tokens=8192,
            role="modifier"
        )
        return {
            "cad_code": self.llm.extract_code(raw_code) or best_match["code"],
            "cached_hit": True
        }

    async def node_atomic_coder(self, state: CadGraphState) -> Dict[str, Any]:
        """Agent 2B: Atomic Coder (Cache Miss or Self-Healing Repair Loop)."""
        logger.info("Executing Agent 2B (Atomic Coder).")
        bom = state.get("bom_json") or {}
        matches = state.get("cache_matches") or []

        sys_prompt = (
            "You are an expert OpenCASCADE and CadQuery engineer. Output ONLY valid Python code inside a ```python ``` block.\n"
            "COORDINATE CONVENTION: +X = Forward/Length, +Y = Left/Right Width (Axle Axis), +Z = Up/Height.\n"
            "CRITICAL CAD MODELING RULES:\n"
            "1. Always `import cadquery as cq` and `import math`.\n"
            "2. Pre-loaded helpers available in global namespace (do NOT redefine or import them):\n"
            "   - `spur_gear(m, z, t, bore=0)` -> returns a cq.Workplane spur gear\n"
            "   - `radial(shape, n, r=0)` -> copies `shape` n times around Z axis and unions them\n"
            "   - `bolt_circle(body, n, r, d, face='>Z')` -> drills n through-holes of diameter d on radius r\n"
            "3. NO BOXY BRICKS FOR VEHICLES/ASSEMBLIES:\n"
            "   - Do NOT model car bodies, fuel tanks, seats, or fairings using `cq.Workplane('XY').box(...)`!\n"
            "   - Instead, draw their 2D side silhouette on `cq.Workplane('XZ').polyline([...]).close().extrude(width/2, both=True)`.\n"
            "   - Model frames, forks, handlebars, and struts using cylinders or swept/extruded tubes (radius 12-25mm), NOT huge bounding boxes.\n"
            "   - Model wheels on `cq.Workplane('XZ')` (so the cylinder extrudes along the Y axle axis: `.circle(r_tire).extrude(width/2, both=True)`), "
            "and cut or join an inner rim/axle cylinder so the wheel has realistic depth.\n"
            "4. For single mechanical parts, union all features into a single connected solid and assign `result = ...`.\n"
            "5. For multi-part assemblies (e.g., rockets, cars, drones), model each sub-component cleanly, assign a dictionary of named sub-parts "
            "`parts = {'body': body, 'nose_cone': nose, 'fins': fins}` AND ALSO union them into `result` (e.g., `result = body.union(nose).union(fins)`). "
            "Avoid `.shell()` on complex multi-body unions as it fails in OpenCASCADE; use solid primitives/lofts/revolves instead.\n"
            "AND ALSO assign `result` at the end (e.g., unioning them or `cq.Compound.makeCompound`).\n"
            "6. The last line of your script MUST define `result`."
        )

        user_content = (
            f"Create a CadQuery model. Units are millimeters, +X forward, +Y left/right, +Z up.\n"
            f"Specification: {state.get('expanded_prompt') or state['raw_prompt']}\n"
            f"BOM: {bom}\n"
        )
        # Inject partial matches (0.70 <= similarity < 0.85) as few-shot reference examples
        if matches:
            user_content += "\nReference Examples:\n"
            for m in matches:
                user_content += f"- {m['prompt']}\n```python\n{m['code']}\n```\n"

        if state.get("error_traceback"):
            user_content += (
                f"\nPREVIOUS CODE:\n```python\n{state.get('cad_code', '')}\n```\n"
                f"FAILED WITH ERROR:\n{state['error_traceback']}\n"
                f"Fix the CadQuery code and ensure `result` is assigned at the end."
            )

        raw_code = await self.llm.generate(
            [{"role": "system", "content": sys_prompt}, {"role": "user", "content": user_content}],
            temperature=0.2,
            max_tokens=16384,
            role="coder"
        )
        return {
            "cad_code": self.llm.extract_code(raw_code),
            "cached_hit": False
        }

    async def node_compiler(self, state: CadGraphState) -> Dict[str, Any]:
        if not state.get("cad_code"):
            return {
                "error_traceback": "Coder returned empty code block.",
                "repair_attempts": state["repair_attempts"] + 1
            }

        wd = f"{settings.out_dir}/{state['job_id']}"
        exec_result = await self.sandbox.run_code(state["cad_code"], wd)

        if not exec_result.get("ok"):
            return {
                "error_traceback": exec_result.get("error", "Unknown runtime error"),
                "repair_attempts": state["repair_attempts"] + 1
            }

        return {"error_traceback": None, "final_result": exec_result}

    def route_compiler_output(self, state: CadGraphState) -> str:
        """Determines if the pipeline should repair, proceed to physics, or fail."""
        if state.get("error_traceback"):
            if state["repair_attempts"] >= 3:
                logger.error(f"Job {state['job_id']} failed after 3 repair attempts.")
                return "fatal"
            return "repair"
        return "success"

    async def node_auditor(self, state: CadGraphState) -> Dict[str, Any]:
        """Agent 4: Computes material mass/physics and auto-caches verified geometry."""
        res = state.get("final_result", {})
        vol_mm3 = float(res.get("volume") or 0.0)
        mat = state.get("material", "Al 6061")
        density_g_cm3 = MATERIAL_DENSITIES_G_CM3.get(mat, 2.70)
        mass_g = round(vol_mm3 * (density_g_cm3 / 1000.0), 2)
        n_solids = res.get("n_solids") or (res.get("counts") or {}).get("solids", 1)
        has_named_parts = bool((res.get("mesh") or {}).get("parts"))

        warning = None
        if n_solids and n_solids > 1 and not has_named_parts:
            warning = f"result has {n_solids} disconnected solids; make features overlap so they fuse into one"

        report = {
            "mass_g": mass_g,
            "density_g_cm3": density_g_cm3,
            "volume_mm3": round(vol_mm3, 2),
            "verified": bool(res.get("valid", True)) and (n_solids == 1 or has_named_parts),
            "warning": warning
        }

        bom = state.get("bom_json") or {}
        canonical_query = bom.get("canonical_query") or state.get("expanded_prompt") or state["raw_prompt"]

        # Persist to Supabase generations table
        self.repo.save_generation({
            "job": state["job_id"],
            "prompt": state["raw_prompt"],
            "material": mat,
            "route": "cache_modifier" if state.get("cached_hit") else "atomic_coder",
            "parent_job": state.get("parent_job"),
            "plan": bom,
            "code": state["cad_code"],
            "ok": True,
            "verified": report["verified"],
            "score": 10 if report["verified"] else 7,
            "bbox": res.get("bbox"),
            "volume_mm3": report["volume_mm3"],
            "mass_g": mass_g,
            "physics": report,
            "attempts": state["repair_attempts"] + 1,
            "llm_model": settings.coder_model
        })

        # Auto-seed verified geometry into cad_examples using the material-agnostic canonical query
        if not state.get("cached_hit") and report["verified"] and state.get("cad_code"):
            try:
                emb = await self.llm.get_embedding(canonical_query)
                self.repo.save_example_to_cache(
                    tags=[bom.get("object", "part")],
                    prompt=canonical_query,
                    code=state["cad_code"],
                    embedding=emb
                )
            except Exception as e:
                logger.warning(f"Auto-cache save skipped: {e}")

        return {"physics_report": report}

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
            "cache_matches": None,
            "cad_code": None,
            "cached_hit": False,
            "error_traceback": None,
            "repair_attempts": 0,
            "physics_report": None,
            "final_result": None
        }
        return await self.graph.ainvoke(initial_state)