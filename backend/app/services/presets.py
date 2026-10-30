"""
Industrial-Grade Multi-Part Parametric CAD Presets.

Allows instant (<2s) zero-LLM previewing in the Brepline 3D Viewer & Crash Lab,
and provides verified sub-components for seeding `public.cad_examples`.
"""
from typing import Dict, Any

SHOWCASE_PRESETS: Dict[str, Dict[str, Any]] = {
    "sports_car": {
        "object": "GT Sports Car",
        "prompt": "Build a GT sports car with a sculpted aerodynamic body shell, translucent glass windshield canopy, 4 rubber wheels with alloy rims, and a rear spoiler",
        "material": "Al 6061",
        "parts": {
            "body_shell": {
                "archetype_tag": "contoured_body",
                "archetype_query": "contoured_body: aerodynamic GT sports car body shell centered at origin, length 4200mm (X=-2100 to +2100), width 1900mm (Y=-950 to +950), height 1280mm, with hollowed window cabin and wheel arch cutouts at X=±1300mm",
                "material": "Steel",
                "color_hex": "#ef4444",
                "translate_mm": [0.0, 0.0, 0.0],
                "code": (
                    "import cadquery as cq\n"
                    "import math\n\n"
                    "half_w = 950.0\n"
                    "profile_pts = [\n"
                    "    (2100.0, 180.0),\n"
                    "    (2100.0, 520.0),\n"
                    "    (1350.0, 780.0),\n"
                    "    (450.0, 1280.0),\n"
                    "    (-750.0, 1260.0),\n"
                    "    (-1650.0, 860.0),\n"
                    "    (-2100.0, 820.0),\n"
                    "    (-2100.0, 220.0),\n"
                    "    (-1550.0, 180.0),\n"
                    "]\n"
                    "body = cq.Workplane('XZ').polyline(profile_pts).close().extrude(half_w, both=True)\n\n"
                    "win_pts = [(1150.0, 810.0), (420.0, 1210.0), (-700.0, 1190.0), (-1400.0, 840.0)]\n"
                    "side_window_cut = cq.Workplane('XZ').polyline(win_pts).close().extrude(half_w + 10.0, both=True)\n"
                    "windshield_cut = (\n"
                    "    cq.Workplane('XZ')\n"
                    "    .polyline([(1280.0, 790.0), (430.0, 1220.0), (-720.0, 1200.0), (-1480.0, 840.0)])\n"
                    "    .close()\n"
                    "    .extrude(half_w - 110.0, both=True)\n"
                    ")\n"
                    "body = body.cut(side_window_cut).cut(windshield_cut)\n\n"
                    "arch = cq.Workplane('XZ').circle(375.0).extrude(340.0)\n"
                    "for wx in (1300.0, -1300.0):\n"
                    "    body = body.cut(arch.translate((wx, half_w - 300.0, 340.0)))\n"
                    "    body = body.cut(arch.translate((wx, -half_w - 40.0, 340.0)))\n\n"
                    "result = body\n"
                )
            },
            "cabin_glass": {
                "archetype_tag": "contoured_body",
                "archetype_query": "contoured_body: translucent cabin glass windshield and side window greenhouse fitting from Z=785mm to Z=1235mm, width 1670mm",
                "material": "Glass",
                "color_hex": "#38bdf8",
                "translate_mm": [0.0, 0.0, 0.0],
                "code": (
                    "import cadquery as cq\n"
                    "import math\n\n"
                    "glass_outer = [(1260.0, 785.0), (430.0, 1235.0), (-720.0, 1215.0), (-1460.0, 845.0)]\n"
                    "glass_inner = [(1160.0, 785.0), (400.0, 1185.0), (-680.0, 1165.0), (-1360.0, 845.0)]\n"
                    "outer = cq.Workplane('XZ').polyline(glass_outer).close().extrude(835.0, both=True)\n"
                    "inner = cq.Workplane('XZ').polyline(glass_inner).close().extrude(780.0, both=True)\n"
                    "result = outer.cut(inner)\n"
                )
            },
            "wheel_set": {
                "archetype_tag": "wheel_set",
                "archetype_query": "wheel_set: four automotive wheels with outer tire diameter 680mm, alloy rim diameter 430mm, width 270mm at X=±1300mm, Y=±810mm, Z=340mm",
                "material": "Rubber",
                "color_hex": "#1e293b",
                "translate_mm": [0.0, 0.0, 0.0],
                "code": (
                    "import cadquery as cq\n"
                    "import math\n\n"
                    "tire = cq.Workplane('XZ').circle(340.0).circle(215.0).extrude(135.0, both=True)\n"
                    "rim_disc = cq.Workplane('XZ').circle(215.0).circle(45.0).extrude(40.0, both=True)\n"
                    "single_wheel = tire.union(rim_disc)\n"
                    "wheels = []\n"
                    "for wx in (1300.0, -1300.0):\n"
                    "    for wy in (810.0, -810.0):\n"
                    "        wheels.append(single_wheel.translate((wx, wy, 340.0)).val())\n"
                    "result = cq.Compound.makeCompound(wheels)\n"
                )
            },
            "rear_spoiler": {
                "archetype_tag": "radial_fin_set",
                "archetype_query": "radial_fin_set: rear GT wing airfoil span 1760mm, chord 260mm with dual swan-neck pylons at X=-1960mm, Z=1100mm",
                "material": "Carbon Fiber",
                "color_hex": "#334155",
                "translate_mm": [0.0, 0.0, 0.0],
                "code": (
                    "import cadquery as cq\n"
                    "import math\n\n"
                    "wing = cq.Workplane('XY').box(260.0, 1760.0, 28.0).translate((-1960.0, 0.0, 1100.0))\n"
                    "pylon_l = cq.Workplane('XY').box(180.0, 24.0, 280.0).translate((-1920.0, 520.0, 960.0))\n"
                    "pylon_r = cq.Workplane('XY').box(180.0, 24.0, 280.0).translate((-1920.0, -520.0, 960.0))\n"
                    "result = wing.union(pylon_l).union(pylon_r)\n"
                )
            }
        }
    },
    "sounding_rocket": {
        "object": "Sounding Rocket",
        "prompt": "Build a multi-stage sounding rocket with nose cone, fuselage, boat-tail nozzle, and 4 swept fins",
        "material": "Al 6061",
        "parts": {
            "tail_nozzle": {
                "archetype_tag": "conical_frustum",
                "archetype_query": "conical_frustum: rocket exhaust nozzle and boat-tail from Z=0 to Z=300mm, bottom diameter 90mm, top diameter 150mm",
                "material": "Titanium",
                "color_hex": "#64748b",
                "translate_mm": [0.0, 0.0, 0.0],
                "code": (
                    "import cadquery as cq\n"
                    "result = cq.Workplane('XY').circle(45.0).workplane(offset=300.0).circle(75.0).loft()\n"
                )
            },
            "fuselage_body": {
                "archetype_tag": "cylindrical_tube",
                "archetype_query": "cylindrical_tube: hollow rocket fuselage tube along +Z, outer diameter 150mm, inner diameter 138mm, length 1500mm",
                "material": "Al 6061",
                "color_hex": "#cbd5e1",
                "translate_mm": [0.0, 0.0, 300.0],
                "code": (
                    "import cadquery as cq\n"
                    "result = cq.Workplane('XY').circle(75.0).circle(69.0).extrude(1500.0)\n"
                )
            },
            "nose_cone": {
                "archetype_tag": "ogive_cone",
                "archetype_query": "ogive_cone: aerodynamic multi-stage lofted nose cone along +Z, base diameter 150mm, height 500mm",
                "material": "Titanium",
                "color_hex": "#f59e0b",
                "translate_mm": [0.0, 0.0, 1800.0],
                "code": (
                    "import cadquery as cq\n"
                    "result = (\n"
                    "    cq.Workplane('XY')\n"
                    "    .circle(75.0)\n"
                    "    .workplane(offset=250.0).circle(46.0)\n"
                    "    .workplane(offset=250.0).circle(1.5)\n"
                    "    .loft()\n"
                    ")\n"
                )
            },
            "fin_set": {
                "archetype_tag": "radial_fin_set",
                "archetype_query": "radial_fin_set: 4 swept delta rocket fins around +Z axis, body_radius 75mm, root_chord 380mm, tip_chord 120mm, semi_span 180mm, thickness 6mm",
                "material": "Carbon Fiber",
                "color_hex": "#ef4444",
                "translate_mm": [0.0, 0.0, 320.0],
                "code": (
                    "import cadquery as cq\n"
                    "fin_pts = [(73.0, 0.0), (255.0, 60.0), (255.0, 180.0), (73.0, 380.0)]\n"
                    "single_fin = cq.Workplane('XZ').polyline(fin_pts).close().extrude(3.0, both=True)\n"
                    "result = radial(single_fin, 4)\n"
                )
            }
        }
    }
}