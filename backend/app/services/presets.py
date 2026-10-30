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
                "archetype_query": "contoured_body: aerodynamic GT sports car body shell centered at origin, length 4200mm (X=-2100 rear to +2100 front nose), width 1900mm (Y=-950 to +950), height 1260mm, with hollowed window cabin and wheel arch cutouts at X=±1300mm",
                "material": "Steel",
                "color_hex": "#ef4444",
                "translate_mm": [0.0, 0.0, 0.0],
                "code": (
                    "import cadquery as cq\n"
                    "import math\n\n"
                    "half_w = 950.0\n"
                    "# +X is low aerodynamic Front Nose (+2100); -X is Rear Tail Deck (-2100)\n"
                    "profile_pts = [\n"
                    "    (2100.0, 170.0),\n"
                    "    (2100.0, 440.0),\n"
                    "    (1300.0, 740.0),\n"
                    "    (400.0, 1250.0),\n"
                    "    (-650.0, 1230.0),\n"
                    "    (-1550.0, 830.0),\n"
                    "    (-2100.0, 780.0),\n"
                    "    (-2100.0, 210.0),\n"
                    "    (-1500.0, 170.0),\n"
                    "]\n"
                    "body = cq.Workplane('XZ').polyline(profile_pts).close().extrude(half_w, both=True)\n\n"
                    "win_pts = [(1120.0, 770.0), (380.0, 1180.0), (-620.0, 1160.0), (-1380.0, 810.0)]\n"
                    "side_window_cut = cq.Workplane('XZ').polyline(win_pts).close().extrude(half_w + 10.0, both=True)\n"
                    "windshield_cut = (\n"
                    "    cq.Workplane('XZ')\n"
                    "    .polyline([(1240.0, 755.0), (390.0, 1190.0), (-640.0, 1170.0), (-1440.0, 815.0)])\n"
                    "    .close()\n"
                    "    .extrude(half_w - 100.0, both=True)\n"
                    ")\n"
                    "body = body.cut(side_window_cut).cut(windshield_cut)\n\n"
                    "arch = cq.Workplane('XZ').circle(380.0).extrude(340.0)\n"
                    "for wx in (1300.0, -1300.0):\n"
                    "    body = body.cut(arch.translate((wx, half_w - 290.0, 340.0)))\n"
                    "    body = body.cut(arch.translate((wx, -half_w - 50.0, 340.0)))\n\n"
                    "result = body\n"
                )
            },
            "cabin_glass": {
                "archetype_tag": "contoured_body",
                "archetype_query": "contoured_body: translucent cabin glass windshield and side window greenhouse fitting from Z=755mm to Z=1205mm, width 1700mm",
                "material": "Glass",
                "color_hex": "#38bdf8",
                "translate_mm": [0.0, 0.0, 0.0],
                "code": (
                    "import cadquery as cq\n"
                    "import math\n\n"
                    "glass_outer = [(1230.0, 755.0), (390.0, 1205.0), (-640.0, 1185.0), (-1420.0, 815.0)]\n"
                    "glass_inner = [(1130.0, 755.0), (360.0, 1150.0), (-600.0, 1130.0), (-1320.0, 815.0)]\n"
                    "outer = cq.Workplane('XZ').polyline(glass_outer).close().extrude(850.0, both=True)\n"
                    "inner = cq.Workplane('XZ').polyline(glass_inner).close().extrude(790.0, both=True)\n"
                    "result = outer.cut(inner)\n"
                )
            },
            "wheel_set": {
                "archetype_tag": "wheel_set",
                "archetype_query": "wheel_set: four 5-spoke sports car wheels with outer tire diameter 680mm, alloy rim diameter 440mm, width 270mm at X=±1300mm, Y=±820mm, Z=340mm",
                "material": "Rubber",
                "color_hex": "#1e293b",
                "translate_mm": [0.0, 0.0, 0.0],
                "code": (
                    "import cadquery as cq\n"
                    "import math\n\n"
                    "# Outer tire ring + recessed 5-spoke star alloy wheel so side profile looks 3D!\n"
                    "tire = cq.Workplane('XZ').circle(340.0).circle(220.0).extrude(135.0, both=True)\n"
                    "rim_barrel = cq.Workplane('XZ').circle(225.0).circle(195.0).extrude(125.0, both=True)\n"
                    "hub = cq.Workplane('XZ').circle(70.0).circle(25.0).extrude(90.0, both=True)\n"
                    "wheel = tire.union(rim_barrel).union(hub)\n"
                    "for i in range(5):\n"
                    "    ang = math.radians(i * 72.0)\n"
                    "    sx, sz = math.cos(ang) * 130.0, math.sin(ang) * 130.0\n"
                    "    spoke = (\n"
                    "        cq.Workplane('XZ')\n"
                    "        .rect(170.0, 34.0)\n"
                    "        .extrude(75.0, both=True)\n"
                    "        .rotate((0, 0, 0), (0, 1, 0), -i * 72.0)\n"
                    "        .translate((sx * 0.5, 0.0, sz * 0.5))\n"
                    "    )\n"
                    "    wheel = wheel.union(spoke)\n\n"
                    "wheels = []\n"
                    "for wx in (1300.0, -1300.0):\n"
                    "    for wy in (820.0, -820.0):\n"
                    "        wheels.append(wheel.translate((wx, wy, 340.0)).val())\n"
                    "result = cq.Compound.makeCompound(wheels)\n"
                )
            },
            "rear_spoiler": {
                "archetype_tag": "radial_fin_set",
                "archetype_query": "radial_fin_set: rear GT wing airfoil span 1740mm, chord 240mm with dual pylons mounted on rear deck at X=-1940mm, Z=800..1020mm",
                "material": "Carbon Fiber",
                "color_hex": "#334155",
                "translate_mm": [0.0, 0.0, 0.0],
                "code": (
                    "import cadquery as cq\n"
                    "import math\n\n"
                    "# Mounted on low rear trunk deck (Z=1020mm, below the Z=1250mm roof!)\n"
                    "wing = cq.Workplane('XY').box(240.0, 1740.0, 24.0).translate((-1950.0, 0.0, 1020.0))\n"
                    "endplate_l = cq.Workplane('XY').box(260.0, 16.0, 90.0).translate((-1950.0, 870.0, 1015.0))\n"
                    "endplate_r = cq.Workplane('XY').box(260.0, 16.0, 90.0).translate((-1950.0, -870.0, 1015.0))\n"
                    "pylon_l = cq.Workplane('XY').box(160.0, 22.0, 220.0).translate((-1910.0, 500.0, 900.0))\n"
                    "pylon_r = cq.Workplane('XY').box(160.0, 22.0, 220.0).translate((-1910.0, -500.0, 900.0))\n"
                    "result = wing.union(endplate_l).union(endplate_r).union(pylon_l).union(pylon_r)\n"
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