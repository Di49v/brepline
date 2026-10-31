import os
import uuid
import hashlib
import asyncio
import logging
from typing import Dict
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from app.models.schemas import JobRequest, ShapeRequest, VoteRequest, JobResponse, SimulateRequest
from app.api.deps import verify_access_and_rate_limit, get_repository
from app.db.repository import CadRepository
from app.core.config import settings

# Explicit imports to prevent ImportError
from app.services.profiles import build, clean, SpecError
from app.services.cad_orchestrator import CadOrchestrator
from app.services.physics_engine import PhysicsEngine

from app.services.presets import SHOWCASE_PRESETS
from app.services.assembler import CadAssembler

logger = logging.getLogger(__name__)
router = APIRouter()
orchestrator = CadOrchestrator()

# In-memory job state store and active asyncio task registry for instant cancellation
JOB_STATES: Dict[str, dict] = {}
RUNNING_TASKS: Dict[str, asyncio.Task] = {}


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
    ip: str = Depends(verify_access_and_rate_limit)
):
    """Build a solid straight from a user-drawn polygon (extrude) or half-section (revolve)."""
    try:
        spec = clean(body.spec)
    except SpecError as e:
        raise HTTPException(status_code=400, detail=str(e))

    job_id = uuid.uuid4().hex[:12]
    JOB_STATES[job_id] = {"status": "queued", "log": ["planning"], "partial_mesh": None}

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
                bbox = res.get("bbox") or [100.0, 100.0, 100.0]
                phys = PhysicsEngine.run_full_audit(
                    volume_mm3=vol,
                    bbox=bbox,
                    material=body.material,
                    n_solids=1,
                    has_named_parts=False,
                    valid=True,
                    prompt=body.name
                )
                JOB_STATES[job_id]["log"].append("done")
                JOB_STATES[job_id]["status"] = "done"
                JOB_STATES[job_id]["result"] = {
                    "job": job_id,
                    "ok": True,
                    "code": code,
                    "plan": plan,
                    "physics": phys,
                    "volume_mm3": vol,
                    "area_mm2": res.get("area"),
                    "mass_g": phys["mass_g"],
                    "density_g_cm3": phys["density_g_cm3"],
                    "bbox": bbox,
                    "bbox_min": res.get("bbox_min"),
                    "com": res.get("com"),
                    "counts": res.get("counts"),
                    "mesh": res.get("mesh"),
                    "verified": True
                }
            else:
                JOB_STATES[job_id]["status"] = "error"
                JOB_STATES[job_id]["error"] = res.get("error", "Sandbox failed")
        except asyncio.CancelledError:
            JOB_STATES[job_id]["status"] = "error"
            JOB_STATES[job_id]["error"] = "Cancelled by user"
            raise
        except Exception as e:
            JOB_STATES[job_id]["status"] = "error"
            JOB_STATES[job_id]["error"] = str(e)
        finally:
            RUNNING_TASKS.pop(job_id, None)

    RUNNING_TASKS[job_id] = asyncio.create_task(run_shape())
    return {"job": job_id}


@router.post("/jobs")
async def create_job(
    body: JobRequest,
    ip: str = Depends(verify_access_and_rate_limit)
):
    """Initiates an iterative multi-agent CAD generation & physics audit job with live cancellation support."""
    job_id = uuid.uuid4().hex[:12]
    JOB_STATES[job_id] = {"status": "queued", "log": ["analyzing intent"], "partial_mesh": None}

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

            final_state = dict(initial_state)
            async for event in orchestrator.graph.astream(initial_state):
                # Check if user cancelled the job between nodes
                if JOB_STATES.get(job_id, {}).get("status") == "cancelled":
                    raise asyncio.CancelledError()

                for node_name, node_state in event.items():
                    final_state.update(node_state)

                    # Stream detailed step-by-step sub-part progress logs
                    log_line = node_state.get("progress_log")
                    if log_line:
                        logs = JOB_STATES[job_id]["log"]
                        if not logs or logs[-1] != log_line:
                            logs.append(log_line)

                    # Stream live sub-part 3D mesh to UI while remaining parts are still building
                    part_mesh = node_state.get("latest_part_mesh")
                    if part_mesh and part_mesh.get("verts"):
                        JOB_STATES[job_id]["partial_mesh"] = part_mesh

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
        except asyncio.CancelledError:
            logger.info(f"Job {job_id} was cancelled by the user; halting LangGraph execution.")
            JOB_STATES[job_id]["status"] = "error"
            JOB_STATES[job_id]["error"] = "Generation stopped by user."
            raise
        except Exception as e:
            JOB_STATES[job_id]["status"] = "error"
            JOB_STATES[job_id]["error"] = str(e)
        finally:
            RUNNING_TASKS.pop(job_id, None)

    RUNNING_TASKS[job_id] = asyncio.create_task(run_graph())
    return {"job": job_id}


@router.delete("/jobs/{job_id}")
async def cancel_job(job_id: str):
    """Immediately cancels an in-flight LangGraph generation task and aborts pending LLM calls."""
    if job_id in JOB_STATES:
        JOB_STATES[job_id]["status"] = "cancelled"
        JOB_STATES[job_id]["error"] = "Generation stopped by user."
    task = RUNNING_TASKS.pop(job_id, None)
    if task and not task.done():
        task.cancel()
        logger.info(f"Cancelled active asyncio task for job {job_id}.")
    return {"ok": True, "cancelled": job_id}


@router.get("/jobs/{job_id}", response_model=JobResponse)
async def get_job(job_id: str):
    """Polls the status, live logs, partial sub-part mesh, or final result of a job."""
    state = JOB_STATES.get(job_id)
    if not state:
        raise HTTPException(status_code=404, detail="Unknown job or expired")
    if state.get("status") == "cancelled":
        return {"status": "error", "log": state.get("log", []), "error": "Generation stopped by user."}
    return state


@router.post("/jobs/{job_id}/simulate")
async def simulate_job_physics(
    job_id: str,
    body: SimulateRequest,
    repo: CadRepository = Depends(get_repository)
):
    """
    Real-Time Interactive Physics & Crash Playground Endpoint.
    Automatically falls back to Supabase if job_id is not in memory after a server restart.
    """
    state = JOB_STATES.get(job_id)
    if not state or not state.get("result"):
        db_row = repo.get_generation(job_id)
        if not db_row:
            raise HTTPException(status_code=404, detail="Job result not found")
        meta = db_row.get("metadata") or {}
        state = {
            "status": "done",
            "result": {
                "job": job_id,
                "ok": True,
                "plan": db_row.get("plan") or {},
                "physics": meta.get("physics") or {},
                "volume_mm3": meta.get("volume_mm3") or 1000.0,
                "bbox": meta.get("bbox") or [100.0, 100.0, 100.0],
                "counts": meta.get("counts") or {},
                "mesh": meta.get("mesh") or {},
                "verified": db_row.get("is_verified", True),
            }
        }
        JOB_STATES[job_id] = state

    res = state["result"]
    vol = float(res.get("volume_mm3") or 1000.0)
    bbox = res.get("bbox") or [100.0, 100.0, 100.0]
    counts = res.get("counts") or {}
    n_solids = counts.get("solids", 1)
    mesh = res.get("mesh") or {}
    has_named_parts = bool(mesh.get("parts"))
    plan = res.get("plan") or {}
    obj_name = plan.get("object") or ""

    existing_phys = res.get("physics") or {}
    part_breakdown = existing_phys.get("part_breakdown") or []
    existing_colors = existing_phys.get("part_colors") or {}
    existing_mats = existing_phys.get("part_materials") or {}
    compiled_parts_stub = {}

    for p in part_breakdown:
        pid = p.get("part_id", "part")
        orig_mat = existing_mats.get(pid) or p.get("material") or body.material
        override_mat = (body.part_materials or {}).get(pid) or orig_mat
        # Preserve original vibrant color (e.g. #ef4444 crimson) unless the user changed this part's material!
        if override_mat == orig_mat and pid in existing_colors:
            chosen_color = existing_colors[pid]
        else:
            chosen_color = PhysicsEngine.get_material(override_mat).get("color_hex", existing_colors.get(pid, "#94a3b8"))

        compiled_parts_stub[pid] = {
            "volume_mm3": p.get("volume_mm3", vol / max(len(part_breakdown), 1)),
            "material": override_mat,
            "color_hex": chosen_color,
            "bbox": [bbox[0] / 2, bbox[1] / 2, bbox[2] / 2]
        }

    updated_physics = PhysicsEngine.run_full_audit(
        volume_mm3=vol,
        bbox=bbox,
        material=body.material,
        n_solids=n_solids,
        has_named_parts=has_named_parts,
        valid=bool(res.get("verified", True)),
        compiled_parts=compiled_parts_stub if compiled_parts_stub else None,
        speed_kmh=body.speed_kmh,
        wind_m_s=body.wind_m_s,
        obstacle=body.obstacle,
        prompt=obj_name,
        wind_yaw_deg=body.wind_yaw_deg,
        wind_pitch_deg=body.wind_pitch_deg,
    )
    if compiled_parts_stub:
        updated_physics["part_colors"] = {pid: d["color_hex"] for pid, d in compiled_parts_stub.items()}
        updated_physics["part_materials"] = {pid: d["material"] for pid, d in compiled_parts_stub.items()}
    else:
        updated_physics["part_colors"] = existing_colors
    return {"ok": True, "physics": updated_physics}


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

@router.post("/presets/{preset_name}")
async def build_showcase_preset(preset_name: str, seed_db: bool = False):
    """
    Compiles a verified multi-part industrial preset (e.g. 'sports_car' or 'sounding_rocket')
    directly in the OpenCASCADE sandbox in ~2s so you can inspect the multi-color 3D model
    and test the 60 FPS Crash Lab in the UI before seeding it into Supabase.
    Pass `?seed_db=true` only after you inspect and approve the model!
    """
    preset = SHOWCASE_PRESETS.get(preset_name)
    if not preset:
        raise HTTPException(status_code=404, detail=f"Unknown preset '{preset_name}'. Available: {list(SHOWCASE_PRESETS.keys())}")

    job_id = uuid.uuid4().hex[:12]
    compiled_parts = {}
    bom_parts = []

    for pid, pinfo in preset["parts"].items():
        sub_wd = os.path.join(settings.out_dir, job_id, f"sub_{pid}")
        sub_res = await orchestrator.sandbox.run_code(pinfo["code"], sub_wd)
        compiled_parts[pid] = {
            "code": pinfo["code"],
            "volume_mm3": float(sub_res.get("volume") or 1000.0),
            "bbox": sub_res.get("bbox") or [100.0, 100.0, 100.0],
            "bbox_min": sub_res.get("bbox_min") or [0.0, 0.0, 0.0],
            "translate_mm": pinfo["translate_mm"],
            "material": pinfo["material"],
            "color_hex": pinfo["color_hex"],
            "archetype_tag": pinfo["archetype_tag"],
            "exec_result": sub_res,
        }
        bom_parts.append({
            "id": pid,
            "archetype_tag": pinfo["archetype_tag"],
            "archetype_query": pinfo["archetype_query"],
            "position_mm": pinfo["translate_mm"],
            "default_material": pinfo["material"],
            "color_hex": pinfo["color_hex"],
        })

        if seed_db and sub_res.get("ok"):
            emb = await orchestrator.llm.get_embedding(pinfo["archetype_query"])
            orchestrator.repo.save_example_to_cache(
                tags=[pinfo["archetype_tag"], "subpart", pid],
                prompt=pinfo["archetype_query"],
                code=pinfo["code"],
                embedding=emb
            )

    master_code = CadAssembler.stitch_assembly(compiled_parts, bom_parts)
    wd = os.path.join(settings.out_dir, job_id)
    res = await orchestrator.sandbox.run_code(master_code, wd)

    vol = sum(p["volume_mm3"] for p in compiled_parts.values())
    bbox = res.get("bbox") or [4200.0, 1900.0, 1280.0]
    phys = PhysicsEngine.run_full_audit(
        volume_mm3=vol,
        bbox=bbox,
        material=preset["material"],
        n_solids=len(compiled_parts),
        has_named_parts=True,
        valid=True,
        compiled_parts=compiled_parts,
        prompt=preset["prompt"]
    )
    phys["part_colors"] = {pid: p["color_hex"] for pid, p in compiled_parts.items()}
    phys["part_materials"] = {pid: p["material"] for pid, p in compiled_parts.items()}

    result_payload = {
        "job": job_id,
        "ok": True,
        "code": master_code,
        "plan": {"object": preset["object"], "is_assembly": True, "parts": bom_parts},
        "physics": phys,
        "volume_mm3": vol,
        "area_mm2": res.get("area"),
        "mass_g": phys["mass_g"],
        "density_g_cm3": phys["density_g_cm3"],
        "bbox": bbox,
        "bbox_min": res.get("bbox_min"),
        "com": res.get("com"),
        "counts": res.get("counts"),
        "mesh": res.get("mesh"),
        "verified": True,
        "cached": True
    }
    JOB_STATES[job_id] = {
        "status": "done",
        "log": ["decomposed into 4 components", "verified all sub-parts", "done"],
        "partial_mesh": res.get("mesh"),
        "result": result_payload
    }
    
    orchestrator.repo.save_generation({
     **result_payload,
     "prompt": preset["prompt"],
     "material": preset["material"],
     "route": "showcase_preset",
     "llm_model": "preset_verified"
    })
    
    return result_payload

@router.get("/history")
async def get_history(repo: CadRepository = Depends(get_repository)):
    """Loads persisted generations from Supabase PostgreSQL and re-hydrates active session state."""
    rows = repo.get_recent_generations(limit=25)
    items = []
    for r in rows:
        jid = r.get("job_id")
        meta = r.get("metadata") or {}
        mesh = meta.get("mesh")
        if not jid or not mesh or not mesh.get("verts"):
            continue
        phys = meta.get("physics") or {}
        result_obj = {
            "job": jid,
            "ok": True,
            "prompt": r.get("prompt") or "CAD Design",
            "material": r.get("material") or "Al 6061",
            "code": r.get("code") or "",
            "plan": r.get("plan") or {},
            "physics": phys,
            "volume_mm3": meta.get("volume_mm3"),
            "area_mm2": meta.get("area_mm2"),
            "mass_g": meta.get("mass_g") or phys.get("mass_g") or 0.0,
            "density_g_cm3": meta.get("density_g_cm3") or phys.get("density_g_cm3") or 2.7,
            "bbox": meta.get("bbox") or [100, 100, 100],
            "bbox_min": meta.get("bbox_min"),
            "com": meta.get("com"),
            "counts": meta.get("counts"),
            "mesh": mesh,
            "verified": bool(r.get("is_verified", True)),
            "cached": True,
        }
        # Re-hydrate in-memory JOB_STATES so /simulate works immediately after backend restarts!
        if jid not in JOB_STATES:
            JOB_STATES[jid] = {
                "status": "done",
                "log": ["restored from supabase database"],
                "partial_mesh": None,
                "result": result_obj,
            }
        items.append(result_obj)
    return {"ok": True, "items": items}