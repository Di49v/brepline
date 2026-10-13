import uuid
import hashlib
from fastapi import APIRouter, Depends, HTTPException, Request, BackgroundTasks
from app.models.schemas import JobRequest, ShapeRequest, VoteRequest, JobResponse
from app.api.deps import verify_access_and_rate_limit, get_repository
from app.db.repository import CadRepository
# We will build this orchestrator in the next step
from app.services.cad_orchestrator import CadPipeline 

router = APIRouter()
pipeline = CadPipeline()

@router.post("/shape/validate")
async def validate_shape(
    body: ShapeRequest, 
    ip: str = Depends(verify_access_and_rate_limit)
):
    """Pure-python check of a drawn polygon / profile (no CAD, no LLM, no rate limit)."""
    from app.services import profiles
    try:
        _, plan, spec = profiles.build(body.spec)
        return {
            "ok": True, 
            "spec": spec, 
            "bbox": plan.get("overall_size_mm"),
            "volume_mm3": plan.get("expect_volume_mm3")
        }
    except profiles.SpecError as e:
        return {"ok": False, "error": str(e)}

@router.post("/shape")
async def create_shape(
    body: ShapeRequest, 
    background_tasks: BackgroundTasks,
    ip: str = Depends(verify_access_and_rate_limit)
):
    """Build a solid straight from a user-drawn polygon (extrude) or half-section (revolve)."""
    from app.services import profiles
    try:
        spec = profiles.clean(body.spec)
    except profiles.SpecError as e:
        raise HTTPException(status_code=400, detail=str(e))
        
    job_id = uuid.uuid4().hex[:12]
    # Fire the deterministic build task in the background
    background_tasks.add_task(pipeline.run_shape_job, job_id, body.model_copy(update={"spec": spec}))
    return {"job": job_id}

@router.post("/jobs")
async def create_job(
    body: JobRequest, 
    background_tasks: BackgroundTasks,
    ip: str = Depends(verify_access_and_rate_limit)
):
    """Initiates an LLM-driven CAD generation job."""
    job_id = uuid.uuid4().hex[:12]
    # Fire the LLM orchestrator in the background
    background_tasks.add_task(pipeline.run_job, job_id, body)
    return {"job": job_id}

@router.get("/jobs/{job_id}", response_model=JobResponse)
async def get_job(job_id: str):
    """Polls the status of an ongoing or completed job."""
    state = pipeline.get_job_state(job_id)
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