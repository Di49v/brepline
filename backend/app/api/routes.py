import uuid
import hashlib
import asyncio
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from app.models.schemas import JobRequest, ShapeRequest, VoteRequest, JobResponse
from app.api.deps import verify_access_and_rate_limit, get_repository
from app.db.repository import CadRepository

# Explicit imports to prevent ImportError
from app.services.profiles import build, clean, SpecError
from app.services.cad_orchestrator import CadOrchestrator

router = APIRouter()
orchestrator = CadOrchestrator()

# Temporary in-memory state store for the API to poll. 
# In production, this reads directly from Supabase.
JOB_STATES = {}

@router.post("/shape/validate")
async def validate_shape(
    body: ShapeRequest, 
    ip: str = Depends(verify_access_and_rate_limit)
):
    """Pure-python check of a drawn polygon / profile (no CAD, no LLM, no rate limit)."""
    try:
        _, plan, spec = build(body.spec)
        return {
            "ok": True, 
            "spec": spec, 
            "bbox": plan.get("overall_size_mm"),
            "volume_mm3": plan.get("expect_volume_mm3")
        }
    except SpecError as e:
        return {"ok": False, "error": str(e)}

@router.post("/shape")
async def create_shape(
    body: ShapeRequest, 
    background_tasks: BackgroundTasks,
    ip: str = Depends(verify_access_and_rate_limit)
):
    """Build a solid straight from a user-drawn polygon (extrude) or half-section (revolve)."""
    try:
        spec = clean(body.spec)
    except SpecError as e:
        raise HTTPException(status_code=400, detail=str(e))
        
    job_id = uuid.uuid4().hex[:12]
    JOB_STATES[job_id] = {"status": "queued", "log": ["Starting deterministic shape build..."]}
    
    # Background execution for deterministic shapes
    async def run_shape():
        JOB_STATES[job_id]["status"] = "running"
        try:
            code, plan, _ = build(spec)
            wd = f"{orchestrator.sandbox.base_dir}/../cad_out/{job_id}"
            res = await orchestrator.sandbox.run_code(code, wd)
            
            if res.get("ok"):
                JOB_STATES[job_id]["status"] = "done"
                JOB_STATES[job_id]["result"] = {"ok": True, "code": code, "volume_mm3": res.get("volume"), "bbox": res.get("bbox")}
            else:
                JOB_STATES[job_id]["status"] = "error"
                JOB_STATES[job_id]["error"] = res.get("error", "Sandbox failed")
        except Exception as e:
            JOB_STATES[job_id]["status"] = "error"
            JOB_STATES[job_id]["error"] = str(e)

    background_tasks.add_task(run_shape)
    return {"job": job_id}

@router.post("/jobs")
async def create_job(
    body: JobRequest, 
    background_tasks: BackgroundTasks,
    ip: str = Depends(verify_access_and_rate_limit)
):
    """Initiates an LLM-driven CAD generation job using LangGraph."""
    job_id = uuid.uuid4().hex[:12]
    JOB_STATES[job_id] = {"status": "queued", "log": ["planning"]}
    
    async def run_graph():
        JOB_STATES[job_id]["status"] = "running"
        try:
            initial_state = {
                "job_id": job_id,
                "raw_prompt": body.prompt,
                "expanded_prompt": None,
                "bom_json": None,
                "cad_code": None,
                "error_traceback": None,
                "repair_attempts": 0,
                "physics_report": None,
                "final_result": None
            }
            
            # Stream the LangGraph execution live
            final_state = dict(initial_state)
            async for event in orchestrator.graph.astream(initial_state):
                for node_name, node_state in event.items():
                    final_state.update(node_state)
                    
                    # Map Agent nodes to the legacy logs App.jsx expects
                    if node_name == "intent_analyzer":
                        JOB_STATES[job_id]["log"].append("planning")
                    elif node_name == "specifier":
                        JOB_STATES[job_id]["log"].append("generating candidates")
                    elif node_name == "coder":
                        attempt = final_state.get('repair_attempts', 0)
                        if attempt > 0:
                            JOB_STATES[job_id]["log"].append(f"repair round {attempt}")
                    elif node_name == "compiler":
                        if not final_state.get("error_traceback"):
                            JOB_STATES[job_id]["log"].append("best candidate found")
                    elif node_name == "auditor":
                        JOB_STATES[job_id]["log"].append("done")

            # Handle Final State
            if final_state.get("error_traceback") and not final_state.get("final_result"):
                JOB_STATES[job_id]["status"] = "error"
                JOB_STATES[job_id]["error"] = final_state["error_traceback"]
            else:
                JOB_STATES[job_id]["status"] = "done"
                res = final_state.get("final_result", {})
                JOB_STATES[job_id]["result"] = {
                    "ok": True, 
                    "code": final_state.get("cad_code"), 
                    "volume_mm3": res.get("volume"), 
                    "bbox": res.get("bbox"),
                    "physics": final_state.get("physics_report")
                }
        except Exception as e:
            JOB_STATES[job_id]["status"] = "error"
            JOB_STATES[job_id]["error"] = str(e)

    background_tasks.add_task(run_graph)
    return {"job": job_id}

@router.get("/jobs/{job_id}", response_model=JobResponse)
async def get_job(job_id: str):
    """Polls the status of an ongoing or completed job."""
    state = JOB_STATES.get(job_id)
    if not state:
        raise HTTPException(status_code=404, detail="Unknown job or expired")
    return state

@router.post("/feedback")
async def submit_feedback(
    body: VoteRequest, 
    ip: str = Depends(verify_access_and_rate_limit),
    repo: CadRepository = Depends(get_repository)
):
    """Records user thumbs-up/down feedback into Supabase."""
    ip_hash = hashlib.sha1(ip.encode()).hexdigest()[:10]
    # Execute DB write on a background thread automatically via FastAPI/Supabase sync client
    repo.save_feedback(body.job, body.vote, body.comment, ip_hash)
    return {"ok": True}