from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Dict, Any, Literal


class JobRequest(BaseModel):
    prompt: str = Field(..., min_length=2, max_length=1500, description="The textual CAD prompt")
    material: str = Field(default="Al 6061", description="Target material for mass calculation")
    parent_job: Optional[str] = Field(default=None, pattern=r"^[0-9a-f]{12}$", description="12-hex UUID of parent job")
    fresh: bool = Field(default=False, description="Bypass cache if true")


class ShapeRequest(BaseModel):
    spec: Dict[str, Any] = Field(..., description="Polygon or revolve specification from UI")
    name: str = Field(default="", max_length=120)
    material: str = Field(default="Al 6061")
    parent_job: Optional[str] = Field(default=None, pattern=r"^[0-9a-f]{12}$")


class SimulateRequest(BaseModel):
    material: str = Field(default="Al 6061", description="Selected material for stress/crash simulation")
    speed_kmh: float = Field(default=64.0, ge=5.0, le=350.0, description="Impact velocity in km/h")
    wind_m_s: float = Field(default=45.0, ge=0.0, le=200.0, description="Crosswind shear speed in m/s")
    obstacle: Literal["concrete_wall", "bollard_pole", "wind_and_thrust"] = Field(
        default="concrete_wall",
        description="Selected obstacle preset for edge-case simulation"
    )
    part_materials: Optional[Dict[str, str]] = Field(
        default=None,
        description="Optional per-subpart material overrides e.g. {'nose_cone': 'Titanium', 'fuselage': 'Al 6061'}"
    )


class VoteRequest(BaseModel):
    job: str = Field(..., pattern=r"^[0-9a-f]{12}$")
    vote: Literal["up", "down", "none"]
    comment: str = Field(default="", max_length=500)


class MeshData(BaseModel):
    verts: List[float]
    tris: List[int]
    tri_part: Optional[List[int]] = None
    parts: Optional[List[str]] = None


class JobResult(BaseModel):
    job: Optional[str] = None
    ok: bool
    bbox: Optional[List[float]] = None
    bbox_min: Optional[List[float]] = None
    volume_mm3: Optional[float] = None
    area_mm2: Optional[float] = None
    mass_g: Optional[float] = None
    density_g_cm3: Optional[float] = None
    com: Optional[List[float]] = None
    counts: Optional[Dict[str, int]] = None
    n_solids: Optional[int] = None
    files: Optional[Dict[str, bool]] = None
    mesh: Optional[MeshData] = None
    code: Optional[str] = None
    plan: Optional[Dict[str, Any]] = None
    physics: Optional[Dict[str, Any]] = None
    verified: Optional[bool] = None
    cached: Optional[bool] = None
    check_detail: Optional[str] = None
    warning: Optional[str] = None
    error: Optional[str] = None


class JobResponse(BaseModel):
    status: Literal["queued", "running", "done", "error"]
    log: List[str] = Field(default_factory=list)
    partial_mesh: Optional[MeshData] = None  # Streams intermediate sub-part 3D mesh while status == "running"
    error: Optional[str] = None
    result: Optional[JobResult] = None

    model_config = ConfigDict(populate_by_name=True)