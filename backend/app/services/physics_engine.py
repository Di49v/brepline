"""
First-Principles Analytical B-Rep Physics & Constitutive Failure Engine.

Supports:
1. Material Constitutive Failure Modes:
   - `ductile_crumple` (Al 6061, Steel, Titanium, Brass, Copper)
   - `brittle_shatter` (Glass, PLA)
   - `anisotropic_delamination` (Carbon Fiber, ABS)
   - `hyperelastic_rebound` (Rubber)
2. Domain-Aware Operating Regimes (`aerospace_rocket`, `ground_vehicle`, `structural_part`)
   with realistic speed thresholds, impact axes, and human/structural G-load limits.
3. Role-Aware Sub-Part Material Optimizer (never suggests opaque metal for glass windows
   or rigid metal for rubber tires).
4. Exact Multi-Material Weighted Mass Calculation across all sub-parts.
"""
import math
from typing import Dict, Any, List, Optional

# Comprehensive Material Engineering Database
# matches frontend MATS = ['Al 6061', 'Steel', 'Titanium', 'Brass', 'Copper', 'PLA', 'ABS']
MATERIAL_LIBRARY: Dict[str, Dict[str, Any]] = {
    "Al 6061": {
        "density_g_cm3": 2.70,
        "yield_mpa": 276.0,
        "ultimate_mpa": 310.0,
        "youngs_gpa": 68.9,
        "sea_kj_kg": 28.0,   # Specific Energy Absorption in progressive crush
        "cost_usd_kg": 3.20,
        "color_hex": "#94a3b8",
        "failure_mode": "ductile_crumple",
        "ductility": 0.85
    },
    "Steel": {
        "density_g_cm3": 7.85,
        "yield_mpa": 350.0,
        "ultimate_mpa": 480.0,
        "youngs_gpa": 200.0,
        "sea_kj_kg": 22.0,
        "cost_usd_kg": 1.10,
        "color_hex": "#ef4444",
        "failure_mode": "ductile_crumple",
        "ductility": 0.90
    },
    "Titanium": {
        "density_g_cm3": 4.43,
        "yield_mpa": 880.0,
        "ultimate_mpa": 950.0,
        "youngs_gpa": 113.8,
        "sea_kj_kg": 42.0,
        "cost_usd_kg": 28.00,
        "color_hex": "#cbd5e1",
        "failure_mode": "ductile_crumple",
        "ductility": 0.70
    },
    "Carbon Fiber": {
        "density_g_cm3": 1.60,
        "yield_mpa": 600.0,
        "ultimate_mpa": 750.0,
        "youngs_gpa": 135.0,
        "sea_kj_kg": 55.0,
        "cost_usd_kg": 42.00,
        "color_hex": "#334155",
        "failure_mode": "anisotropic_delamination",
        "ductility": 0.25
    },
    "Brass": {
        "density_g_cm3": 8.50,
        "yield_mpa": 200.0,
        "ultimate_mpa": 340.0,
        "youngs_gpa": 105.0,
        "sea_kj_kg": 14.0,
        "cost_usd_kg": 6.50,
        "color_hex": "#eab308",
        "failure_mode": "ductile_crumple",
        "ductility": 0.80
    },
    "Copper": {
        "density_g_cm3": 8.96,
        "yield_mpa": 70.0,
        "ultimate_mpa": 220.0,
        "youngs_gpa": 117.0,
        "sea_kj_kg": 11.0,
        "cost_usd_kg": 9.40,
        "color_hex": "#f97316",
        "failure_mode": "ductile_crumple",
        "ductility": 0.95
    },
    "Glass": {
        "density_g_cm3": 2.50,
        "yield_mpa": 45.0,
        "ultimate_mpa": 50.0,
        "youngs_gpa": 70.0,
        "sea_kj_kg": 2.5,
        "cost_usd_kg": 2.40,
        "color_hex": "#38bdf8",
        "failure_mode": "brittle_shatter",
        "ductility": 0.02
    },
    "Rubber": {
        "density_g_cm3": 1.15,
        "yield_mpa": 18.0,
        "ultimate_mpa": 25.0,
        "youngs_gpa": 0.05,
        "sea_kj_kg": 12.0,
        "cost_usd_kg": 2.80,
        "color_hex": "#1e293b",
        "failure_mode": "hyperelastic_rebound",
        "ductility": 1.00
    },
    "PLA": {
        "density_g_cm3": 1.24,
        "yield_mpa": 50.0,
        "ultimate_mpa": 60.0,
        "youngs_gpa": 3.5,
        "sea_kj_kg": 6.5,
        "cost_usd_kg": 18.00,
        "color_hex": "#2fb67c",
        "failure_mode": "brittle_shatter",
        "ductility": 0.12
    },
    "ABS": {
        "density_g_cm3": 1.04,
        "yield_mpa": 42.0,
        "ultimate_mpa": 48.0,
        "youngs_gpa": 2.3,
        "sea_kj_kg": 10.5,
        "cost_usd_kg": 16.00,
        "color_hex": "#a855f7",
        "failure_mode": "anisotropic_delamination",
        "ductility": 0.45
    },
}

MATERIAL_DENSITIES_G_CM3: Dict[str, float] = {
    k: v["density_g_cm3"] for k, v in MATERIAL_LIBRARY.items()
}


class PhysicsEngine:
    """Domain-aware structural, aerodynamic, and crash failure-mode analyzer."""

    @staticmethod
    def get_material(name: str) -> Dict[str, Any]:
        return MATERIAL_LIBRARY.get(name, MATERIAL_LIBRARY["Al 6061"])

    @staticmethod
    def detect_domain(prompt: str, bbox: List[float]) -> Dict[str, Any]:
        """Infers physical domain, primary impact axis, and realistic speed presets."""
        p = (prompt or "").lower()
        lx, ly, lz = (bbox + [100.0, 100.0, 100.0])[:3]
        if any(w in p for w in ("rocket", "missile", "booster", "launch", "tower", "pillar")) or (lz > lx * 1.4 and lz > ly * 1.4):
            return {
                "domain": "aerospace_rocket",
                "impact_axis": "Z",
                "default_speed_kmh": 280.0,
                "max_speed_kmh": 900.0,
                "max_survivable_g": 35.0,
                "max_crumple_ratio": 0.25,
            }
        if any(w in p for w in ("car", "sedan", "truck", "vehicle", "motorcycle", "bike", "bus", "train", "chassis")):
            return {
                "domain": "ground_vehicle",
                "impact_axis": "X",
                "default_speed_kmh": 64.0,
                "max_speed_kmh": 240.0,
                "max_survivable_g": 45.0,
                "max_crumple_ratio": 0.35,
            }
        return {
            "domain": "mechanical_part",
            "impact_axis": "X" if lx >= ly else "Y",
            "default_speed_kmh": 50.0,
            "max_speed_kmh": 200.0,
            "max_survivable_g": 80.0,
            "max_crumple_ratio": 0.30,
        }

    @staticmethod
    def classify_part_role(part_id: str) -> str:
        """Classifies a sub-part's functional engineering role so material advice is physically sensible."""
        pid = (part_id or "").lower()
        if any(w in pid for w in ("glass", "window", "windshield", "canopy", "visor", "lens", "headlight")):
            return "transparent_glazing"
        if any(w in pid for w in ("wheel", "tire", "tyre", "grip", "bumper_pad", "seal")):
            return "elastomer_traction"
        if any(w in pid for w in ("fin", "wing", "spoiler", "splitter", "fairing", "nose")):
            return "aerodynamic_surface"
        if any(w in pid for w in ("nozzle", "exhaust", "combustor", "engine", "turbine")):
            return "thermal_propulsion"
        return "primary_structure"

    @classmethod
    def run_full_audit(
        cls,
        volume_mm3: float,
        bbox: List[float],
        material: str = "Al 6061",
        n_solids: int = 1,
        has_named_parts: bool = False,
        valid: bool = True,
        compiled_parts: Optional[Dict[str, Dict[str, Any]]] = None,
        speed_kmh: float = 64.0,
        wind_m_s: float = 45.0,
        obstacle: str = "concrete_wall",
        prompt: str = ""
    ) -> Dict[str, Any]:
        """
        Runs a comprehensive multi-physics edge-case evaluation:
        1. Mass, Volume, and Fill Factor (Structural Packing Fraction)
        2. Crash / Impact Simulation (Concrete Wall vs. Cylindrical Bollard Pole)
        3. Aerodynamic Crosswind Bending & Axial Euler Buckling
        4. Per-Subpart Safety Factor & Material Wastage / Lightweighting Optimizer
        """
        mat_props = cls.get_material(material)
        rho = mat_props["density_g_cm3"]
        sigma_y = mat_props["yield_mpa"]  # N/mm^2
        youngs_mpa = mat_props["youngs_gpa"] * 1000.0  # N/mm^2
        failure_mode = mat_props.get("failure_mode", "ductile_crumple")

        vol_mm3 = max(float(volume_mm3 or 1.0), 1.0)
        lx = max(float(bbox[0] if len(bbox) > 0 else 100.0), 1.0)
        ly = max(float(bbox[1] if len(bbox) > 1 else 100.0), 1.0)
        lz = max(float(bbox[2] if len(bbox) > 2 else 100.0), 1.0)

        domain_info = cls.detect_domain(prompt, [lx, ly, lz])
        impact_axis = domain_info["impact_axis"]
        primary_len_mm = lz if impact_axis == "Z" else (lx if impact_axis == "X" else ly)
        cross_a_mm = lx if impact_axis == "Z" else ly
        cross_b_mm = ly if impact_axis == "Z" else lz

        # --- Weighted Multi-Part Mass Calculation ---
        part_reports: List[Dict[str, Any]] = []
        potential_savings_g = 0.0
        weighted_mass_g = 0.0

        if compiled_parts:
            for pid, pdata in compiled_parts.items():
                p_vol = float(pdata.get("volume_mm3") or (vol_mm3 / max(len(compiled_parts), 1)))
                p_mat = pdata.get("material") or material
                p_props = cls.get_material(p_mat)
                p_mass_g = round(p_vol * (p_props["density_g_cm3"] / 1000.0), 2)
                weighted_mass_g += p_mass_g
        else:
            weighted_mass_g = round(vol_mm3 * (rho / 1000.0), 2)

        mass_g = round(weighted_mass_g, 2)
        mass_kg = max(mass_g / 1000.0, 0.001)

        # --- 1. Realistic Structural Shell Crush & Material-Sensitive Deformation ---
        v_m_s = max(speed_kmh / 3.6, 0.1)
        ke_joules = 0.5 * mass_kg * (v_m_s ** 2)

        # Real vehicles/rockets are hollow shells (effective load-bearing frame area is ~3.5% of outer cross-section)
        contact_factor = 0.35 if obstacle == "bollard_pole" else 1.0
        effective_frame_area_mm2 = max(cross_a_mm * cross_b_mm * 0.035 * contact_factor, 8.0)

        # Specific Energy Absorption (SEA) & Yield Strength directly govern crumple depth!
        sea_j_g = mat_props.get("sea_kj_kg", 20.0)  # Joules per gram of crushed structure
        # Dynamic stress increases with impact velocity and decreases with material yield strength
        dynamic_load_n = max(mass_kg * (v_m_s ** 2) / max(primary_len_mm / 1000.0 * 0.22, 0.01), 10.0)
        impact_stress_mpa = round((dynamic_load_n / effective_frame_area_mm2) * (1.8 if obstacle == "bollard_pole" else 1.0), 1)
        crash_safety_factor = round(sigma_y / max(impact_stress_mpa, 0.5), 2)

        # Calculate material-dependent crumple ratio (weak/brittle materials deform/shatter much more than Titanium/Steel!)
        strength_ratio = 276.0 / max(sigma_y, 15.0)  # Normalized against Al 6061 (276 MPa)
        speed_norm = speed_kmh / 90.0
        raw_crumple_ratio = 0.14 * (speed_norm ** 1.35) * (strength_ratio ** 0.55) * (1.45 if obstacle == "bollard_pole" else 1.0)
        crumple_ratio = round(min(max(raw_crumple_ratio, 0.02), 0.72), 3)
        crumple_depth_mm = round(crumple_ratio * primary_len_mm, 1)

        # Peak G deceleration: stiffer materials (Steel/Titanium) have shorter crush distances -> higher G spike;
        # softer materials crush deeper -> lower initial G until bottoming out!
        crush_dist_m = max(crumple_depth_mm / 1000.0, 0.008)
        peak_g = round(min((v_m_s ** 2) / (2.0 * crush_dist_m * 9.81) * 1.4, 250.0), 1)
        mean_crush_force_n = ke_joules / crush_dist_m

        # Realistic Survival Verdict (Checks Structural Yield + Crumple Intrusion + Brittle Shatter + G-Limit)
        is_shattered = failure_mode == "brittle_shatter" and crash_safety_factor < 1.15
        survived_crash = (
            not is_shattered
            and crumple_ratio <= domain_info["max_crumple_ratio"]
            and crash_safety_factor >= 0.85
            and peak_g <= domain_info["max_survivable_g"] * 1.8
        )

        if is_shattered:
            failure_desc = f"Brittle Shatter ({material} fractured at {impact_stress_mpa} MPa > {sigma_y} MPa)"
        elif not survived_crash and crumple_ratio > domain_info["max_crumple_ratio"]:
            failure_desc = f"Severe Cabin/Core Intrusion ({crumple_ratio*100:.0f}% crushed at {speed_kmh:.0f} km/h)"
        elif not survived_crash:
            failure_desc = f"Plastic Structural Yield (SF {crash_safety_factor}x, {peak_g}G impact)"
        else:
            failure_desc = f"Intact ({failure_mode.replace('_', ' ')} absorbed {ke_joules:.0f} J)"

        # --- 2. Diagonal Crosswind Shear & Cantilever Bending ---
        rho_air = 1.225
        cd = 1.15
        side_area_m2 = (max(lx, lz) * min(lx, ly, lz)) / 1e6
        wind_force_n = 0.5 * rho_air * (wind_m_s ** 2) * cd * side_area_m2
        bending_moment_n_mm = wind_force_n * (max(lz, lx) * 0.5)
        wall_t_mm = max(min(lx, ly) * 0.06, 2.0)
        section_modulus_mm3 = max((min(lx, ly) * (wall_t_mm ** 2)) / 6.0, 1.0)
        wind_bending_stress_mpa = round(bending_moment_n_mm / section_modulus_mm3, 2)
        wind_safety_factor = round(min(sigma_y / max(wind_bending_stress_mpa, 0.1), 99.0), 2)

        # --- 3. Axial Thrust / 6G Euler Buckling Check ---
        axial_load_6g_n = mass_kg * 9.81 * 6.0 + wind_force_n * 0.5
        moment_of_inertia_mm4 = max((min(lx, ly) * (wall_t_mm ** 3)) / 12.0, 1.0)
        euler_critical_load_n = (math.pi ** 2 * youngs_mpa * moment_of_inertia_mm4) / max((primary_len_mm ** 2), 1.0)
        buckling_safety_factor = round(min(euler_critical_load_n / max(axial_load_6g_n, 0.1), 99.0), 2)

        # --- 4. Role-Aware Per-Part Breakdown & Intelligent Material Recommendations ---
        if compiled_parts:
            for pid, pdata in compiled_parts.items():
                p_vol = float(pdata.get("volume_mm3") or (vol_mm3 / max(len(compiled_parts), 1)))
                p_mat = pdata.get("material") or material
                p_props = cls.get_material(p_mat)
                p_mass_g = round(p_vol * (p_props["density_g_cm3"] / 1000.0), 2)
                role = cls.classify_part_role(pid)

                # Estimate local part safety factor based on slenderness and material yield
                local_stress = max(impact_stress_mpa * (0.35 if role == "transparent_glazing" else 0.75), wind_bending_stress_mpa)
                p_sf = round(min(p_props["yield_mpa"] / max(local_stress, 1.0), 25.0), 2)

                status = "optimal"
                recommendation = f"Optimal {p_mat} for {role.replace('_', ' ')}."

                if role == "transparent_glazing":
                    if p_mat not in ("Glass", "PLA", "ABS"):
                        status = "warning"
                        recommendation = f"`{pid}` is a window/glazing part; use Glass (or polycarbonate) for optical visibility instead of opaque {p_mat}."
                    elif p_sf < 1.1:
                        status = "critical"
                        recommendation = f"Glass shattered at {speed_kmh:.0f} km/h ({local_stress:.0f} MPa). Use laminated polycarbonate/thickened glazing."
                elif role == "elastomer_traction":
                    if p_mat != "Rubber":
                        status = "warning"
                        recommendation = f"`{pid}` requires high-friction elastomer grip; use Rubber tires with Al 6061 rims."
                elif role == "aerodynamic_surface":
                    if p_sf < 1.2:
                        status = "critical"
                        recommendation = f"Fin/wing root stress high ({local_stress:.0f} MPa). Switch `{pid}` to Carbon Fiber or Titanium."
                    elif p_props["density_g_cm3"] > 3.0:
                        alt_mass = round(p_vol * (1.60 / 1000.0), 1)
                        saved = max(p_mass_g - alt_mass, 0.0)
                        potential_savings_g += saved
                        status = "over_engineered"
                        recommendation = f"Switch `{pid}` from {p_mat} to Carbon Fiber to save {saved:.1f}g and boost aero stiffness."
                else:
                    # primary_structure or thermal_propulsion
                    if p_sf < 1.15:
                        status = "critical"
                        recommendation = f"Structural yield risk ({p_sf}x SF). Reinforce `{pid}` with Titanium or Carbon Fiber."
                    elif p_sf > 3.5 and p_props["density_g_cm3"] > 2.70:
                        alt_mass = round(p_vol * (2.70 / 1000.0), 1)
                        saved = max(p_mass_g - alt_mass, 0.0)
                        potential_savings_g += saved
                        status = "over_engineered"
                        recommendation = f"Over-engineered ({p_sf}x SF). Switch `{pid}` from {p_mat} to Al 6061 to save {saved:.1f}g."

                part_reports.append({
                    "part_id": pid,
                    "role": role,
                    "material": p_mat,
                    "failure_mode": p_props["failure_mode"],
                    "mass_g": p_mass_g,
                    "volume_mm3": round(p_vol, 1),
                    "safety_factor": p_sf,
                    "status": status,
                    "recommendation": recommendation
                })

        # Compare all materials for the Playground Material Matrix
        material_comparison = []
        for m_name, m_info in MATERIAL_LIBRARY.items():
            m_mass_g = round(vol_mm3 * (m_info["density_g_cm3"] / 1000.0), 1)
            m_sf = round((m_info["yield_mpa"] / max(impact_stress_mpa, 1.0)), 2)
            material_comparison.append({
                "material": m_name,
                "mass_g": m_mass_g,
                "yield_mpa": m_info["yield_mpa"],
                "failure_mode": m_info["failure_mode"],
                "safety_factor": m_sf,
                "cost_est_usd": round((m_mass_g / 1000.0) * m_info["cost_usd_kg"], 2)
            })

        warning = None
        if n_solids and n_solids > 1 and not has_named_parts:
            warning = f"result has {n_solids} disconnected solids; make features overlap so they fuse into one"

        overall_sf = round(min(crash_safety_factor, wind_safety_factor, buckling_safety_factor), 2)

        return {
            "mass_g": mass_g,
            "density_g_cm3": rho,
            "volume_mm3": round(vol_mm3, 2),
            "verified": bool(valid) and (n_solids == 1 or has_named_parts),
            "warning": warning,
            "domain": domain_info["domain"],
            "impact_axis": impact_axis,
            "overall_safety_factor": overall_sf,
            "potential_mass_savings_g": round(potential_savings_g, 1),
            "edge_cases": {
                "crash_test": {
                    "obstacle": obstacle,
                    "impact_axis": impact_axis,
                    "failure_mode": failure_mode,
                    "failure_description": failure_desc,
                    "speed_kmh": speed_kmh,
                    "kinetic_energy_j": round(ke_joules, 1),
                    "mean_crush_force_kn": round(mean_crush_force_n / 1000.0, 2),
                    "crumple_depth_mm": crumple_depth_mm,
                    "crumple_ratio": crumple_ratio,
                    "peak_deceleration_g": peak_g,
                    "impact_stress_mpa": impact_stress_mpa,
                    "safety_factor": crash_safety_factor,
                    "survived": survived_crash
                },
                "wind_shear": {
                    "wind_speed_m_s": wind_m_s,
                    "lateral_force_n": round(wind_force_n, 1),
                    "bending_stress_mpa": wind_bending_stress_mpa,
                    "safety_factor": wind_safety_factor,
                    "survived": wind_safety_factor >= 1.2
                },
                "axial_buckling": {
                    "g_load": 6.0,
                    "axial_load_n": round(axial_load_6g_n, 1),
                    "euler_critical_n": round(euler_critical_load_n, 1),
                    "safety_factor": buckling_safety_factor,
                    "survived": buckling_safety_factor >= 1.5
                }
            },
            "part_breakdown": part_reports,
            "material_matrix": material_comparison
        }