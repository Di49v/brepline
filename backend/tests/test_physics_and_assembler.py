import pytest
from app.services.physics_engine import PhysicsEngine
from app.services.assembler import CadAssembler
from app.services.llm import LLMService


def test_assembler_stitches_isolated_functions():
    compiled = {
        "nose_cone": {
            "code": "import cadquery as cq\nr = 50\nresult = cq.Workplane('XY').circle(r).extrude(100)\n",
            "translate_mm": [0.0, 0.0, 200.0]
        },
        "fuselage": {
            "code": "import cadquery as cq\nr = 50\nresult = cq.Workplane('XY').circle(r).extrude(200)\n",
            "translate_mm": [0.0, 0.0, 0.0]
        }
    }
    bom_parts = [
        {"id": "fuselage", "position_mm": [0.0, 0.0, 0.0]},
        {"id": "nose_cone", "position_mm": [0.0, 0.0, 200.0]},
    ]
    stitched = CadAssembler.stitch_assembly(compiled, bom_parts)
    assert "def _build_fuselage():" in stitched
    assert "def _build_nose_cone():" in stitched
    assert "parts['nose_cone'] = _build_nose_cone().translate((0.0, 0.0, 200.0))" in stitched
    assert "result = cq.Compound.makeCompound(_solids)" in stitched


def test_physics_engine_crash_and_obstacle_regimes():
    wall_report = PhysicsEngine.run_full_audit(
        volume_mm3=250_000.0,
        bbox=[400.0, 180.0, 140.0],
        material="Al 6061",
        speed_kmh=80.0,
        obstacle="concrete_wall"
    )
    pole_report = PhysicsEngine.run_full_audit(
        volume_mm3=250_000.0,
        bbox=[400.0, 180.0, 140.0],
        material="Al 6061",
        speed_kmh=80.0,
        obstacle="bollard_pole"
    )
    # Bollard pole concentrates impact onto smaller area -> deeper crumple penetration than flat wall
    assert pole_report["edge_cases"]["crash_test"]["crumple_depth_mm"] >= wall_report["edge_cases"]["crash_test"]["crumple_depth_mm"]
    assert len(wall_report["material_matrix"]) >= 7


def test_per_model_key_sharding_rotation():
    llm = LLMService()
    fake_pool = ["client_key_1", "client_key_2", "client_key_3"]
    # First call for model A starts with client_key_1
    order_a1 = llm._sharded_clients_for_model(fake_pool, "gemini-3.8-flash")
    assert order_a1[0] == "client_key_1"
    # First call for model B ALSO starts with client_key_1 (independent per-model cursor!)
    order_b1 = llm._sharded_clients_for_model(fake_pool, "gemma-4-31b-it")
    assert order_b1[0] == "client_key_1"
    # Second call for model A rotates to client_key_2
    order_a2 = llm._sharded_clients_for_model(fake_pool, "gemini-3.8-flash")
    assert order_a2[0] == "client_key_2"