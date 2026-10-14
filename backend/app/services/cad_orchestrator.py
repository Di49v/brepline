import logging
from typing import TypedDict, Dict, Any, Optional
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
        """Constructs the LangGraph state machine."""
        workflow = StateGraph(CadGraphState)

        # Add Nodes (Agents)
        workflow.add_node("intent_analyzer", self.node_intent_analyzer)
        workflow.add_node("specifier", self.node_specifier)
        workflow.add_node("coder", self.node_coder)
        workflow.add_node("compiler", self.node_compiler)
        workflow.add_node("auditor", self.node_auditor)

        # Define Edges (Routing)
        workflow.set_entry_point("intent_analyzer")
        workflow.add_edge("intent_analyzer", "specifier")
        workflow.add_edge("specifier", "coder")  # Cache/Router logic injects here later
        workflow.add_edge("coder", "compiler")
        
        # Conditional Routing from Compiler (Success vs Error)
        workflow.add_conditional_edges(
            "compiler",
            self.route_compiler_output,
            {
                "repair": "coder",
                "success": "auditor",
                "fatal": END
            }
        )
        workflow.add_edge("auditor", END)

        return workflow.compile()

    # --- Node Implementations ---

    async def node_intent_analyzer(self, state: CadGraphState) -> Dict[str, Any]:
        """Agent 0: Expands sparse prompts and strips material names so geometry is material-agnostic."""
        sys_prompt = (
            "You are Agent 0: Mechanical Requirements Engineer. Expand the user's CAD prompt into "
            "a clear, material-agnostic geometric specification in millimeters (Z-axis up). "
            "CRITICAL: Remove all material names (e.g., Copper, Aluminum, Steel, PLA) so the geometric "
            "description is 100% independent of material. Output ONLY the expanded geometric prompt."
        )
        expanded = await self.llm.generate(
            [
                {"role": "system", "content": sys_prompt},
                {"role": "user", "content": state["raw_prompt"]}
            ],
            temperature=0.2,
            max_tokens=350,
            role="intent"
        )
        return {"expanded_prompt": expanded.strip()}

    async def node_specifier(self, state: CadGraphState) -> Dict[str, Any]:
        """Agent 1: Decomposes prompt into a structured BOM with a canonical material-agnostic search query."""
        sys_prompt = (
            "You are Agent 1: Chief Mechanical Decomposer. Convert the geometric specification into a strict JSON object:\n"
            "{\n"
            "  \"object\": \"short 2-4 word part name (no material names)\",\n"
            "  \"canonical_query\": \"standardized material-agnostic description of the geometry and dimensions for vector cache lookup\",\n"
            "  \"parts\": [{\"id\": \"main_body\", \"type\": \"primitive_or_feature\", \"dimensions\": {}}],\n"
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
            max_tokens=800,
            role="planner"
        )
        return {"bom_json": self.llm.extract_json(raw_json)}

    async def node_coder(self, state: CadGraphState) -> Dict[str, Any]:
        """Agent 2A (Parametric Modifier on Cache Hit) & Agent 2B (Atomic Coder on Cache Miss)."""
        bom = state.get("bom_json") or {}
        
        # 1. Generate Semantic Embedding of the Intent
        canonical_query = bom.get("canonical_query") or state.get("expanded_prompt") or state["raw_prompt"]

        # 2. Query Supabase pgvector
        matches = []
        if not state.get("fresh"):
            try:
                embedding = await self.llm.get_embedding(canonical_query)
                matches = self.repo.search_similar_cad(embedding, threshold=0.70, limit=2)
            except Exception as e:
                logger.warning(f"Vector cache lookup skipped: {e}")

        best_match = matches[0] if matches else None

        if best_match and best_match["similarity"] >= 0.85 and not state.get("error_traceback"):
            # AGENT 2A: PARAMETRIC MODIFIER (High Confidence Cache Hit)
            logger.info(f"Cache HIT ({best_match['similarity']:.2f}) on '{canonical_query}'. Routing to Agent 2A (Modifier).")
            sys_prompt = (
                "You are Agent 2A: Parametric CAD Modifier. You are given a verified CadQuery script from cache. "
                "If the Target BOM dimensions match the template, return the template code UNCHANGED. "
                "If any dimensions differ, update ONLY those numeric parameters. Output ONLY valid Python code."
            )
            user_content = f"Target BOM:\n{bom}\n\nCached Template Code:\n```python\n{best_match['code']}\n```"
            raw_code = await self.llm.generate(
                [{"role": "system", "content": sys_prompt}, {"role": "user", "content": user_content}],
                temperature=0.2,
                max_tokens=4000,  # <-- Increased to prevent mid-line token truncation
                role="coder"
            )
            return {"cad_code": self.llm.extract_code(raw_code) or best_match["code"], "cached_hit": True}

        # AGENT 2B: ATOMIC CODER (Cache Miss or Repair Loop)
        logger.info("Cache MISS or Repair Loop. Routing to Agent 2B (Atomic Coder).")
        
        sys_prompt = (
            "You are an expert OpenCASCADE and CadQuery engineer. Output ONLY valid Python code inside a markdown block. "
            "CRITICAL REQUIREMENT: You MUST assign your final combined solid object or assembly to a variable named exactly `result` "
            "(e.g., `result = bracket` or `result = gear`). If you do not define `result`, the compilation will fail instantly. "
            "Pre-loaded helper functions available in the global namespace (do NOT redefine or import them):\n"
            "- `spur_gear(m, z, t, bore=0)` -> returns a cq.Workplane spur gear (module m, teeth z, thickness t, bore diameter)\n"
            "- `radial(shape, n, r=0)` -> copies `shape` n times around Z axis and unions them\n"
            "- `bolt_circle(body, n, r, d, face='>Z')` -> drills n through-holes of diameter d on radius r\n"
            "Ensure all boolean features overlap so `result` is a single connected solid."
        )
        
        user_content = (
            f"Create a CadQuery model. Units are millimeters, Z up.\n"
            f"Specification: {state.get('expanded_prompt') or state['raw_prompt']}\n"
            f"BOM: {bom}\n"
        )
        # Inject partial matches as few-shot examples
        if matches:
            user_content += "\nReference Examples:\n"
            for m in matches:
                user_content += f"- {m['prompt']}\n```python\n{m['code']}\n```\n"

        if state.get("error_traceback"):
            user_content += f"\nPREVIOUS CODE FAILED with error:\n{state['error_traceback']}\nFix the CadQuery code."

        # 3. Generate and Extract
        raw_code = await self.llm.generate(
            [{"role": "system", "content": sys_prompt}, {"role": "user", "content": user_content}],
            temperature=0.2,
            role="coder"
        )
        return {"cad_code": self.llm.extract_code(raw_code), "cached_hit": False}

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

        warning = None
        if n_solids and n_solids > 1:
            warning = f"result has {n_solids} disconnected solids; make features overlap so they fuse into one"

        report = {
            "mass_g": mass_g,
            "density_g_cm3": density_g_cm3,
            "volume_mm3": round(vol_mm3, 2),
            "verified": bool(res.get("valid", True)) and (n_solids == 1),
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

        # Auto-seed verified single-solid geometry into cad_examples using the material-agnostic canonical query
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
            "cad_code": None,
            "cached_hit": False,
            "error_traceback": None,
            "repair_attempts": 0,
            "physics_report": None,
            "final_result": None
        }
        return await self.graph.ainvoke(initial_state)