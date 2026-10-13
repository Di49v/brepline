import operator
import logging
from typing import TypedDict, Annotated, List, Dict, Any, Optional
from langgraph.graph import StateGraph, END
from app.services.llm import LLMService
from app.sandbox.executor import SandboxExecutor
from app.db.repository import CadRepository
from app.core.config import settings

logger = logging.getLogger(__name__)

# 1. Define the System State
class CadGraphState(TypedDict):
    job_id: str
    raw_prompt: str
    expanded_prompt: Optional[str]
    bom_json: Optional[Dict[str, Any]]
    cad_code: Optional[str]
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
        """Agent 0: Expands sparse prompts and extracts implicit mechanical requirements."""
        sys_prompt = "You are a Requirements Engineer. Expand the user's CAD request to include reasonable default mechanical constraints if missing (e.g. wall thickness, tolerances). Output ONLY the expanded prompt."
        expanded = await self.llm.generate([
            {"role": "system", "content": sys_prompt},
            {"role": "user", "content": state["raw_prompt"]}
        ], temperature=0.3, max_tokens=300)
        
        return {"expanded_prompt": expanded.strip()}

    async def node_specifier(self, state: CadGraphState) -> Dict[str, Any]:
        """Agent 1: Decomposes the prompt into a structured JSON BOM and interface constraints."""
        sys_prompt = "You are a CAD Planner. Convert the prompt into a JSON object: {'parts': [{'name': '...', 'type': '...', 'dimensions': {}}], 'shared_interfaces': {}}."
        raw_json = await self.llm.generate([
            {"role": "system", "content": sys_prompt},
            {"role": "user", "content": state["expanded_prompt"]}
        ], temperature=0.1, max_tokens=800, planner=True)
        
        return {"bom_json": self.llm.extract_json(raw_json)}

    async def node_coder(self, state: CadGraphState) -> Dict[str, Any]:
        """Agent 2: Generates CadQuery python code using Vector Search routing."""
        
        # 1. Generate Semantic Embedding of the Intent
        embedding = await self.llm.get_embedding(state["expanded_prompt"] or state["raw_prompt"])
        
        # 2. Query Supabase pgvector
        matches = self.repo.search_similar_cad(embedding, threshold=0.70, limit=2)
        
        best_match = matches[0] if matches else None
        
        if best_match and best_match["similarity"] >= 0.85 and not state.get("error_traceback"):
            # AGENT 2A: PARAMETRIC MODIFIER (High Confidence Cache Hit)
            logger.info(f"High similarity hit ({best_match['similarity']}). Invoking Modifier.")
            sys_prompt = "You are a CAD Parametric Modifier. Take the provided working CadQuery code and modify ONLY the variable assignments and dimensions to match the requested BOM constraints. DO NOT alter the core geometric logic or add new workplanes unless requested."
            
            user_content = f"Target BOM/Specs: {state['bom_json']}\n\nWorking Template Code:\n```python\n{best_match['code']}\n```"
            
        else:
            # AGENT 2B: ATOMIC CODER (Cache Miss or Repair Loop)
            logger.info("Cache miss or Repair loop. Invoking Atomic Coder.")
            sys_prompt = "You are an expert CadQuery engineer. Output ONLY valid python code. Assign the final shape to `result`."
            
            user_content = f"BOM/Specs: {state['bom_json']}\n"
            
            # Inject partial matches as few-shot examples
            if matches:
                user_content += "\nReference Examples for syntax/style:\n"
                for m in matches:
                    user_content += f"- {m['prompt']}\n```python\n{m['code']}\n```\n"

            if state.get("error_traceback"):
                user_content += f"\nPREVIOUS CODE FAILED with error:\n{state['error_traceback']}\nAnalyze the traceback and fix the code."

        # 3. Generate and Extract
        raw_code = await self.llm.generate([
            {"role": "system", "content": sys_prompt},
            {"role": "user", "content": user_content}
        ], temperature=0.2, is_coder=True)
        
        clean_code = self.llm.extract_code(raw_code)
        return {"cad_code": clean_code}

    async def node_compiler(self, state: CadGraphState) -> Dict[str, Any]:
        """Agent 3: Executes code in isolated subprocess. Returns metrics or traceback."""
        wd = f"{settings.out_dir}/{state['job_id']}_r{state['repair_attempts']}"
        exec_result = await self.sandbox.run_code(state["cad_code"], wd)

        if not exec_result.get("ok"):
            return {
                "error_traceback": exec_result.get("error", "Unknown runtime error"),
                "repair_attempts": state["repair_attempts"] + 1
            }
        
        return {
            "error_traceback": None,
            "final_result": exec_result
        }

    def route_compiler_output(self, state: CadGraphState) -> str:
        """Determines if the pipeline should repair, proceed to physics, or fail."""
        if state.get("error_traceback"):
            if state["repair_attempts"] >= 3:
                logger.error(f"Job {state['job_id']} failed after 3 repair attempts.")
                return "fatal"
            return "repair"
        return "success"

    async def node_auditor(self, state: CadGraphState) -> Dict[str, Any]:
        """Agent 4: Heuristic Physics check (Volume, Mass, Bounding Box constraints)."""
        res = state.get("final_result", {})
        vol = res.get("volume", 0)
        
        # Basic heuristic: calculate mass assuming Aluminum 6061 (density ~ 2.7e-3 g/mm^3)
        mass_g = vol * 0.0027 
        report = {
            "estimated_mass_g": round(mass_g, 2),
            "volume_mm3": round(vol, 2),
            "safety_warning": "Mass exceeds 5kg limit" if mass_g > 5000 else "Within heuristic safety margins."
        }
        
        # Persist success to database
        self.repo.save_generation({
            "job": state["job_id"],
            "prompt": state["raw_prompt"],
            "code": state["cad_code"],
            "ok": True,
            "score": 10,
            "metadata": {"physics": report}
        })

        return {"physics_report": report}

    async def execute_job(self, job_id: str, prompt: str) -> Dict[str, Any]:
        """Entry point for the FastAPI route."""
        initial_state = {
            "job_id": job_id,
            "raw_prompt": prompt,
            "expanded_prompt": None,
            "bom_json": None,
            "cad_code": None,
            "error_traceback": None,
            "repair_attempts": 0,
            "physics_report": None,
            "final_result": None
        }
        
        # Execute LangGraph asynchronously
        final_state = await self.graph.ainvoke(initial_state)
        return final_state