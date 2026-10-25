"""
First-Principles Analytical B-Rep Physics & Edge-Case Simulation Engine.

Computes deterministic structural, aerodynamic, buckling, and crash-impact
telemetry directly from OpenCASCADE B-Rep mass/bounding properties and
engineering material constants.
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
        "color_hex": "#94a3b8"
    },
    "Steel": {
        "density_g_cm3": 7.85,
        "yield_mpa": 350.0,
        "ultimate_mpa": 480.0,
        "youngs_gpa": 200.0,
        "sea_kj_kg": 22.0,
        "cost_usd_kg": 1.10,
        "color_hex": "#64748b"
    },
    "Titanium": {
        "density_g_cm3": 4.43,
        "yield_mpa": 880.0,
        "ultimate_mpa": 950.0,
        "youngs_gpa": 113.8,
        "sea_kj_kg": 42.0,
        "cost_usd_kg": 28.00,
        "color_hex": "#cbd5e1"
    },
    "Brass": {
        "density_g_cm3": 8.50,
        "yield_mpa": 200.0,
        "ultimate_mpa": 340.0,
        "youngs_gpa": 105.0,
        "sea_kj_kg": 14.0,
        "cost_usd_kg": 6.50,
        "color_hex": "#eab308"
    },
    "Copper": {
        "density_g_cm3": 8.96,
        "yield_mpa": 70.0,
        "ultimate_mpa": 220.0,
        "youngs_gpa": 117.0,
        "sea_kj_kg": 11.0,
        "cost_usd_kg": 9.40,
        "color_hex": "#f97316"
    },
    "PLA": {
        "density_g_cm3": 1.24,
        "yield_mpa": 50.0,
        "ultimate_mpa": 60.0,
        "youngs_gpa": 3.5,
        "sea_kj_kg": 8.5,
        "cost_usd_kg": 18.00,
        "color_hex": "#38bdf8"
    },
    "ABS": {
        "density_g_cm3": 1.04,
        "yield_mpa": 42.0,
        "ultimate_mpa": 48.0,
        "youngs_gpa": 2.3,
        "sea_kj_kg": 10.5,
        "cost_usd_kg": 16.00,
        "color_hex": "#a855f7"
    },
}

MATERIAL_DENSITIES_G_CM3: Dict[str, float] = {
    k: v["density_g_cm3"] for k, v in MATERIAL_LIBRARY.items()
}


class PhysicsEngine:
    """Deterministic structural, aerodynamic, and crash edge-case analyzer."""

    @staticmethod
    def get_material(name: str) -> Dict[str, Any]:
        return MATERIAL_LIBRARY.get(name, MATERIAL_LIBRARY["Al 6061"])

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
        obstacle: str = "concrete_wall"
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

        vol_mm3 = max(float(volume_mm3 or 1.0), 1.0)
        mass_g = round(vol_mm3 * (rho / 1000.0), 2)
        mass_kg = max(mass_g / 1000.0, 0.001)

        lx = max(float(bbox[0] if len(bbox) > 0 else 100.0), 1.0)
        ly = max(float(bbox[1] if len(bbox) > 1 else 100.0), 1.0)
        lz = max(float(bbox[2] if len(bbox) > 2 else 100.0), 1.0)
        bbox_vol = max(lx * ly * lz, 1.0)
        fill_ratio = min(max(vol_mm3 / bbox_vol, 0.02), 1.0)

        # --- 1. Frontal & Obstacle Crash Simulation ---
        v_m_s = max(speed_kmh / 3.6, 0.1)
        ke_joules = 0.5 * mass_kg * (v_m_s ** 2)

        # Effective frontal crush cross-section (mm^2) scaled by packing fraction
        frontal_area_mm2 = ly * lz * (fill_ratio ** 0.65)
        # Bollard pole concentrates impact onto ~35% of the width (higher penetration)
        contact_factor = 0.38 if obstacle == "bollard_pole" else 1.0
        effective_crush_area_mm2 = max(frontal_area_mm2 * contact_factor, 10.0)

        # Progressive plastic crush force F_crush (Newtons)
        # Thin/hollow structures crush at ~0.35 * sigma_y * A_eff
        mean_crush_force_n = max(0.35 * sigma_y * effective_crush_area_mm2, 1.0)
        crumple_depth_mm = min((ke_joules * 1000.0) / mean_crush_force_n, lx * 0.85)
        crumple_ratio = round(crumple_depth_mm / lx, 3)

        # Peak deceleration in Gs (assuming triangular pulse = 2x mean deceleration)
        mean_accel_m_s2 = mean_crush_force_n / max(mass_kg, 0.001)
        peak_g = round(min((2.0 * v_m_s * v_m_s) / (2.0 * max(crumple_depth_mm / 1000.0, 0.005) * 9.81), 250.0), 1)
        impact_stress_mpa = round((mean_crush_force_n * 1.6) / effective_crush_area_mm2, 1)
        crash_safety_factor = round(sigma_y / max(impact_stress_mpa, 1.0), 2)

        # --- 2. Diagonal Crosswind Shear & Cantilever Bending ---
        rho_air = 1.225  # kg/m^3
        cd = 1.15
        side_area_m2 = (lx * lz) / 1e6
        wind_force_n = 0.5 * rho_air * (wind_m_s ** 2) * cd * side_area_m2
        # Cantilever bending moment M = F * (H/2), section modulus Z_s = (lx * ly^2)/6 * fill_ratio
        bending_moment_n_mm = wind_force_n * (lz * 0.5)
        min_thickness_mm = max(min(lx, ly) * (fill_ratio ** 0.5), 1.5)
        section_modulus_mm3 = max((max(lx, ly) * (min_thickness_mm ** 2)) / 6.0, 1.0)
        wind_bending_stress_mpa = round(bending_moment_n_mm / section_modulus_mm3, 2)
        wind_safety_factor = round(min(sigma_y / max(wind_bending_stress_mpa, 0.1), 99.0), 2)

        # --- 3. Axial Thrust / 6G Euler Buckling Check ---
        axial_load_6g_n = mass_kg * 9.81 * 6.0 + wind_force_n * 0.5
        moment_of_inertia_mm4 = max((max(lx, ly) * (min_thickness_mm ** 3)) / 12.0, 1.0)
        euler_critical_load_n = (math.pi ** 2 * youngs_mpa * moment_of_inertia_mm4) / max((lz ** 2), 1.0)
        buckling_safety_factor = round(min(euler_critical_load_n / max(axial_load_6g_n, 0.1), 99.0), 2)

        # --- 4. Per-Part Breakdown & Material Wastage Optimizer ---
        part_reports: List[Dict[str, Any]] = []
        potential_savings_g = 0.0

        if compiled_parts:
            for pid, pdata in compiled_parts.items():
                p_vol = float(pdata.get("volume_mm3") or (vol_mm3 / max(len(compiled_parts), 1)))
                p_mat = pdata.get("material") or material
                p_props = cls.get_material(p_mat)
                p_mass_g = round(p_vol * (p_props["density_g_cm3"] / 1000.0), 2)
                p_bbox = pdata.get("bbox") or [lx / 2, ly / 2, lz / 2]
                p_min_dim = max(min(p_bbox), 1.0)
                p_max_dim = max(max(p_bbox), 1.0)
                slenderness = p_max_dim / p_min_dim

                # Estimate local part safety factor based on slenderness and material yield
                local_stress = max(wind_bending_stress_mpa * (slenderness / 4.0), impact_stress_mpa * 0.4)
                p_sf = round(min(p_props["yield_mpa"] / max(local_stress, 1.0), 25.0), 2)

                status = "optimal"
                recommendation = "Structurally balanced."
                if p_sf < 1.25:
                    status = "critical"
                    recommendation = f"Safety factor low ({p_sf}x). Increase wall thickness by 35% or switch to Titanium."
                elif p_sf > 4.5 and p_props["density_g_cm3"] > 2.70:
                    status = "over_engineered"
                    alt_mass_g = round(p_vol * (2.70 / 1000.0), 2)
                    saved = max(p_mass_g - alt_mass_g, 0.0)
                    potential_savings_g += saved
                    recommendation = f"Over-engineered ({p_sf}x SF). Switch {pid} to Al 6061 to save {saved:.1f}g."

                part_reports.append({
                    "part_id": pid,
                    "material": p_mat,
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
            m_sf = round((m_info["yield_mpa"] / sigma_y) * min(crash_safety_factor, wind_safety_factor), 2)
            material_comparison.append({
                "material": m_name,
                "mass_g": m_mass_g,
                "yield_mpa": m_info["yield_mpa"],
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
            "overall_safety_factor": overall_sf,
            "potential_mass_savings_g": round(potential_savings_g, 1),
            "edge_cases": {
                "crash_test": {
                    "obstacle": obstacle,
                    "speed_kmh": speed_kmh,
                    "kinetic_energy_j": round(ke_joules, 1),
                    "mean_crush_force_kn": round(mean_crush_force_n / 1000.0, 2),
                    "crumple_depth_mm": round(crumple_depth_mm, 1),
                    "crumple_ratio": crumple_ratio,
                    "peak_deceleration_g": peak_g,
                    "impact_stress_mpa": impact_stress_mpa,
                    "safety_factor": crash_safety_factor,
                    "survived": crumple_ratio < 0.45 and crash_safety_factor >= 1.0
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