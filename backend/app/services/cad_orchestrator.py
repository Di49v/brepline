import time
import json
import logging
import asyncio
from typing import Dict, Any, List
from app.core.config import settings
from app.models.schemas import JobRequest, JobResponse, JobResult
from app.services.llm import LLMService
from app.sandbox.executor import SandboxExecutor
from app.db.repository import CadRepository
from examples_lib import EXAMPLES

logger = logging.getLogger(__name__)

class CadPipeline:
    def __init__(self):
        self.llm = LLMService()
        self.sandbox = SandboxExecutor()
        self.repo = CadRepository()
        self.job_state: Dict[str, JobResponse] = {}

    def get_job_state(self, job_id: str) -> JobResponse | None:
        return self.job_state.get(job_id)

    async def run_job(self, job_id: str, request: JobRequest):
        """Main asynchronous pipeline orchestrator."""
        self.job_state[job_id] = JobResponse(status="running", log=["Starting job..."])
        t0 = time.time()
        
        try:
            # 1. Planning Step
            self.job_state[job_id].log.append("Planning geometry...")
            plan = await self._generate_plan(request.prompt)
            
            # 2. Few-Shot Retrieval
            # TODO: Replace with Supabase pgvector retrieval in Milestone 4
            examples = self._retrieve_examples_naive(request.prompt)
            
            # 3. Concurrent Candidate Generation
            self.job_state[job_id].log.append(f"Generating {settings.max_concurrent_jobs} candidates concurrently...")
            msgs = self._build_prompt(request.prompt, plan, examples)
            
            # Fire LLM calls in parallel
            llm_tasks = [self.llm.generate(msgs, temperature=0.2 + (i * 0.2)) for i in range(settings.max_concurrent_jobs)]
            llm_outputs = await asyncio.gather(*llm_tasks, return_exceptions=True)
            
            # 4. Concurrent Sandbox Execution
            self.job_state[job_id].log.append("Executing CadQuery sandboxes...")
            exec_tasks = []
            valid_codes = []
            
            for out in llm_outputs:
                if isinstance(out, Exception):
                    continue
                code = self.llm.extract_code(out)
                if code:
                    valid_codes.append(code)
                    wd = f"{settings.out_dir}/{job_id}_{len(valid_codes)}"
                    exec_tasks.append(self.sandbox.run_code(code, wd))

            results = await asyncio.gather(*exec_tasks, return_exceptions=True)
            
            # 5. Scoring & Selection
            best_result = None
            best_code = None
            best_score = -1
            
            for i, res in enumerate(results):
                if isinstance(res, Exception) or not res.get("ok"):
                    # Save failure to DB asynchronously via background task/repo
                    self.repo.save_failure({"job": job_id, "prompt": request.prompt, "code": valid_codes[i], "stage": "execution"})
                    continue
                
                # Basic scoring heuristic
                score = 10 if res.get("valid") else 5
                if score > best_score:
                    best_score = score
                    best_result = res
                    best_code = valid_codes[i]

            # 6. Finalization
            if best_result:
                elapsed = round(time.time() - t0, 1)
                self.job_state[job_id].log.append(f"Success in {elapsed}s.")
                
                job_result = JobResult(
                    ok=True,
                    code=best_code,
                    volume_mm3=best_result.get("volume"),
                    bbox=best_result.get("bbox")
                )
                self.job_state[job_id].status = "done"
                self.job_state[job_id].result = job_result
                
                # Persist winning generation
                db_record = {
                    "job": job_id,
                    "prompt": request.prompt,
                    "material": request.material,
                    "code": best_code,
                    "ok": True,
                    "score": best_score,
                    "bbox": best_result.get("bbox"),
                    "volume_mm3": best_result.get("volume"),
                    "elapsed_s": elapsed
                }
                self.repo.save_generation(db_record)
            else:
                self.job_state[job_id].status = "error"
                self.job_state[job_id].error = "All candidates failed execution."

        except Exception as e:
            logger.error(f"Pipeline failure for {job_id}: {e}")
            self.job_state[job_id].status = "error"
            self.job_state[job_id].error = str(e)

    async def _generate_plan(self, prompt: str) -> Dict[str, Any]:
        """Calls the LLM to generate a JSON structural plan."""
        sys_prompt = "You are a mechanical design planner. Turn the request into a compact JSON object: {'object': 'short name', 'features': ['step 1', 'step 2']}"
        try:
            raw = await self.llm.generate([
                {"role": "system", "content": sys_prompt},
                {"role": "user", "content": prompt}
            ], temperature=0.1, max_tokens=600, planner=True)
            return self.llm.extract_json(raw)
        except Exception:
            return {}

    def _retrieve_examples_naive(self, prompt: str) -> List[tuple]:
        """Legacy retrieval to be replaced by pgvector."""
        p = prompt.lower()
        scored = sorted(((sum(t in p for t in tags), i) for i, (tags, _, _) in enumerate(EXAMPLES)), reverse=True)
        idx = [i for s, i in scored if s > 0][:3] or [3, 4]
        return [EXAMPLES[i] for i in idx]

    def _build_prompt(self, prompt: str, plan: Dict[str, Any], examples: List[tuple]) -> List[Dict[str, str]]:
        """Assembles the system instructions, few-shot examples, and user prompt."""
        msgs = [{"role": "system", "content": "You are an expert CAD engineer. Return only a CadQuery python script."}]
        for _, req, code in examples:
            msgs.append({"role": "user", "content": f"Request: {req}"})
            msgs.append({"role": "assistant", "content": f"```python\n{code}```"})
        
        user_content = f"Request: {prompt}\n"
        if plan:
            user_content += f"Plan: {json.dumps(plan)}\n"
        msgs.append({"role": "user", "content": user_content})
        return msgs