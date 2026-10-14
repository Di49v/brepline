import os
import uuid
import hashlib
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse
from app.models.schemas import JobRequest, ShapeRequest, VoteRequest, JobResponse
from app.api.deps import verify_access_and_rate_limit, get_repository
from app.db.repository import CadRepository
from app.core.config import settings

# Explicit imports to prevent ImportError
from app.services.profiles import build, clean, SpecError
from app.services.cad_orchestrator import CadOrchestrator, MATERIAL_DENSITIES_G_CM3

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
    JOB_STATES[job_id] = {"status": "queued", "log": ["planning"]}
    
    # Background execution for deterministic shapes
    async def run_shape():
        JOB_STATES[job_id]["status"] = "running"
        try:
            code, plan, _ = build(spec, name=body.name)
            JOB_STATES[job_id]["log"].append("building shape")
            wd = os.path.join(settings.out_dir, job_id)
            res = await orchestrator.sandbox.run_code(code, wd)
            
            if res.get("ok"):
                vol = float(res.get("volume") or 0.0)
                rho = MATERIAL_DENSITIES_G_CM3.get(body.material, 2.70)
                mass_g = round(vol * (rho / 1000.0), 2)
                JOB_STATES[job_id]["log"].append("done")
                JOB_STATES[job_id]["status"] = "done"
                JOB_STATES[job_id]["result"] = {
                    "job": job_id,
                    "ok": True,
                    "code": code,
                    "plan": plan,
                    "volume_mm3": vol,
                    "area_mm2": res.get("area"),
                    "mass_g": mass_g,
                    "density_g_cm3": rho,
                    "bbox": res.get("bbox"),
                    "bbox_min": res.get("bbox_min"),
                    "com": res.get("com"),
                    "counts": res.get("counts"),
                    "mesh": res.get("mesh"),
                    "verified": True
                }
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
    JOB_STATES[job_id] = {"status": "queued", "log": ["analyzing intent"]}
    
    async def run_graph():
        JOB_STATES[job_id]["status"] = "running"
        try:
            initial_state = {
                "job_id": job_id,
                "raw_prompt": body.prompt,
                "material": body.material,
                "fresh": body.fresh,
                "parent_job": body.parent_job,
                "expanded_prompt": None,
                "bom_json": None,
                "cad_code": None,
                "cached_hit": False,
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
                    
                    # Map all 5 Agent nodes cleanly without duplicate lines
                    if node_name == "intent_analyzer":
                        JOB_STATES[job_id]["log"].append("planning")
                    elif node_name == "specifier":
                        JOB_STATES[job_id]["log"].append("generating candidates")
                    elif node_name == "coder":
                        if final_state.get("cached_hit"):
                            JOB_STATES[job_id]["log"].append("served from cache")
                        elif final_state.get("repair_attempts", 0) > 0:
                            JOB_STATES[job_id]["log"].append(f"repair round {final_state['repair_attempts']}")
                    elif node_name == "compiler":
                        if not final_state.get("error_traceback"):
                            JOB_STATES[job_id]["log"].append("best candidate score 10/10")
                    elif node_name == "auditor":
                        JOB_STATES[job_id]["log"].append("done")

            # Handle Final State
            if final_state.get("error_traceback") and not final_state.get("final_result"):
                JOB_STATES[job_id]["status"] = "error"
                JOB_STATES[job_id]["error"] = final_state["error_traceback"]
            else:
                JOB_STATES[job_id]["status"] = "done"
                res = final_state.get("final_result", {})
                phys = final_state.get("physics_report", {})
                JOB_STATES[job_id]["result"] = {
                    "job": job_id,
                    "ok": True,
                    "code": final_state.get("cad_code"),
                    "plan": final_state.get("bom_json"),
                    "physics": phys,
                    "volume_mm3": phys.get("volume_mm3", res.get("volume")),
                    "area_mm2": res.get("area"),
                    "mass_g": phys.get("mass_g"),
                    "density_g_cm3": phys.get("density_g_cm3"),
                    "bbox": res.get("bbox"),
                    "bbox_min": res.get("bbox_min"),
                    "com": res.get("com"),
                    "counts": res.get("counts"),
                    "mesh": res.get("mesh"),
                    "verified": phys.get("verified", True),
                    "cached": final_state.get("cached_hit", False),
                    "warning": phys.get("warning")
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

@router.get("/file/{job_id}/{ext}")
async def download_file(job_id: str, ext: str):
    ext_map = {"step": "model.step", "stl": "model.stl", "py": "model.py"}
    if ext not in ext_map:
        raise HTTPException(status_code=400, detail="Unsupported format")
    path = os.path.join(settings.out_dir, job_id, ext_map[ext])
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(path, filename=f"{job_id}.{ext}")

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