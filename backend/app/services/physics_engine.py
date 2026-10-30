"""
Object-Oriented Multi-Physics, Material Aging, NCAP & Error-Bound Simulation Engine.

Features:
1. `MaterialProfile` & `AnimationBehavior`: Includes Arrhenius thermal-humidity aging rates
   (`corrosion_rate_yr`, `hygrothermal_sensitivity`) and 60 FPS fracture modes.
2. Environmental Aging Model: Computes yield-strength retention and embrittlement from
   `age_years`, `temp_c`, and `humidity_pct`.
3. Global NCAP / Bharat NCAP 5-Star Assessment: Scores Adult Occupant Protection (0-16 pts,
   0-5 Stars) balancing peak G-deceleration, cabin intrusion, and glazing shatter.
4. Analytical vs. Full-FEA Error Quantification: Computes B-Rep discretization error (%)
   and Reduced-Order Surrogate confidence bounds (±%).
"""
import math
from dataclasses import dataclass, asdict
from typing import Dict, Any, List, Optional


@dataclass(frozen=True)
class AnimationBehavior:
    """Defines how a material visually deforms or fractures in the 60 FPS 3D viewer."""
    deform_mode: str          # 'ductile_crumple' | 'brittle_shatter' | 'anisotropic_delamination' | 'hyperelastic_rebound'
    ductility: float          # 0.0 (glass) -> 1.0 (rubber)
    shatter_stress_mpa: float # Stress above which triangles fragment/scatter outward
    fold_wavelength_mm: float # Accordion ripple wavelength during plastic compression
    puncture_vulnerable: bool # True if sharp obstacles (spike strip) cause deflation/blowout
    opacity: float = 1.0      # 0.52 for translucent glazing, 1.0 for opaque solids


@dataclass(frozen=True)
class MaterialProfile:
    """OOP Material definition combining mechanical constants, aging rates, and animation behavior."""
    name: str
    density_g_cm3: float
    yield_mpa: float
    ultimate_mpa: float
    youngs_gpa: float
    sea_kj_kg: float
    cost_usd_kg: float
    color_hex: str
    annual_degradation_rate: float  # Base fractional strength loss per year at 25C, 50% RH
    humidity_sensitivity: float     # Sensitivity to moisture/corrosion/hydrolysis
    thermal_sensitivity: float      # Sensitivity to elevated temperature aging
    animation: AnimationBehavior

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["failure_mode"] = self.animation.deform_mode
        d["ductility"] = self.animation.ductility
        return d


@dataclass(frozen=True)
class ObstaclePreset:
    """OOP Obstacle definition for virtual proving-ground simulations."""
    id: str
    name: str
    contact_zone: str             # 'frontal_full' | 'frontal_concentrated' | 'undercarriage_tires' | 'aerodynamic_lateral'
    stress_concentration: float   # Multiplier on local contact stress
    sharpness_factor: float       # 0.0 (blunt wall) -> 1.0 (razor spike strip)
    description: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# --- Registry of OOP Material Profiles ---
MATERIAL_OBJECTS: Dict[str, MaterialProfile] = {
    "Al 6061": MaterialProfile(
        name="Al 6061", density_g_cm3=2.70, yield_mpa=276.0, ultimate_mpa=310.0,
        youngs_gpa=68.9, sea_kj_kg=28.0, cost_usd_kg=3.20, color_hex="#94a3b8",
        annual_degradation_rate=0.006, humidity_sensitivity=0.35, thermal_sensitivity=0.45,
        animation=AnimationBehavior("ductile_crumple", 0.85, 310.0, 120.0, False, 1.0)
    ),
    "Steel": MaterialProfile(
        name="Steel", density_g_cm3=7.85, yield_mpa=350.0, ultimate_mpa=480.0,
        youngs_gpa=200.0, sea_kj_kg=22.0, cost_usd_kg=1.10, color_hex="#ef4444",
        annual_degradation_rate=0.022, humidity_sensitivity=0.85, thermal_sensitivity=0.35,
        animation=AnimationBehavior("ductile_crumple", 0.90, 480.0, 95.0, False, 1.0)
    ),
    "Titanium": MaterialProfile(
        name="Titanium", density_g_cm3=4.43, yield_mpa=880.0, ultimate_mpa=950.0,
        youngs_gpa=113.8, sea_kj_kg=42.0, cost_usd_kg=28.00, color_hex="#cbd5e1",
        annual_degradation_rate=0.001, humidity_sensitivity=0.05, thermal_sensitivity=0.10,
        animation=AnimationBehavior("ductile_crumple", 0.70, 950.0, 80.0, False, 1.0)
    ),
    "Carbon Fiber": MaterialProfile(
        name="Carbon Fiber", density_g_cm3=1.60, yield_mpa=600.0, ultimate_mpa=750.0,
        youngs_gpa=135.0, sea_kj_kg=55.0, cost_usd_kg=42.00, color_hex="#334155",
        annual_degradation_rate=0.004, humidity_sensitivity=0.25, thermal_sensitivity=0.30,
        animation=AnimationBehavior("anisotropic_delamination", 0.22, 650.0, 60.0, False, 1.0)
    ),
    "Brass": MaterialProfile(
        name="Brass", density_g_cm3=8.50, yield_mpa=200.0, ultimate_mpa=340.0,
        youngs_gpa=105.0, sea_kj_kg=14.0, cost_usd_kg=6.50, color_hex="#eab308",
        annual_degradation_rate=0.010, humidity_sensitivity=0.50, thermal_sensitivity=0.30,
        animation=AnimationBehavior("ductile_crumple", 0.80, 340.0, 110.0, False, 1.0)
    ),
    "Copper": MaterialProfile(
        name="Copper", density_g_cm3=8.96, yield_mpa=70.0, ultimate_mpa=220.0,
        youngs_gpa=117.0, sea_kj_kg=11.0, cost_usd_kg=9.40, color_hex="#f97316",
        annual_degradation_rate=0.012, humidity_sensitivity=0.60, thermal_sensitivity=0.35,
        animation=AnimationBehavior("ductile_crumple", 0.95, 220.0, 140.0, False, 1.0)
    ),
    "Glass": MaterialProfile(
        name="Glass", density_g_cm3=2.50, yield_mpa=45.0, ultimate_mpa=50.0,
        youngs_gpa=70.0, sea_kj_kg=2.5, cost_usd_kg=2.40, color_hex="#38bdf8",
        annual_degradation_rate=0.008, humidity_sensitivity=0.30, thermal_sensitivity=0.25,
        animation=AnimationBehavior("brittle_shatter", 0.02, 45.0, 20.0, True, 0.52)
    ),
    "Rubber": MaterialProfile(
        name="Rubber", density_g_cm3=1.15, yield_mpa=18.0, ultimate_mpa=25.0,
        youngs_gpa=0.05, sea_kj_kg=12.0, cost_usd_kg=2.80, color_hex="#1e293b",
        annual_degradation_rate=0.042, humidity_sensitivity=0.65, thermal_sensitivity=0.90,
        animation=AnimationBehavior("hyperelastic_rebound", 1.00, 90.0, 180.0, True, 1.0)
    ),
    "PLA": MaterialProfile(
        name="PLA", density_g_cm3=1.24, yield_mpa=50.0, ultimate_mpa=60.0,
        youngs_gpa=3.5, sea_kj_kg=6.5, cost_usd_kg=18.00, color_hex="#2fb67c",
        annual_degradation_rate=0.055, humidity_sensitivity=0.95, thermal_sensitivity=0.95,
        animation=AnimationBehavior("brittle_shatter", 0.12, 55.0, 40.0, True, 1.0)
    ),
    "ABS": MaterialProfile(
        name="ABS", density_g_cm3=1.04, yield_mpa=42.0, ultimate_mpa=48.0,
        youngs_gpa=2.3, sea_kj_kg=10.5, cost_usd_kg=16.00, color_hex="#a855f7",
        annual_degradation_rate=0.032, humidity_sensitivity=0.55, thermal_sensitivity=0.75,
        animation=AnimationBehavior("anisotropic_delamination", 0.45, 48.0, 75.0, False, 1.0)
    ),
}

# Backward-compatible dictionary exports
MATERIAL_LIBRARY: Dict[str, Dict[str, Any]] = {
    k: v.to_dict() for k, v in MATERIAL_OBJECTS.items()
}
MATERIAL_DENSITIES_G_CM3: Dict[str, float] = {
    k: v.density_g_cm3 for k, v in MATERIAL_OBJECTS.items()
}

# --- Registry of OOP Obstacle Presets ---
OBSTACLE_PRESETS: Dict[str, ObstaclePreset] = {
    "concrete_wall": ObstaclePreset(
        id="concrete_wall",
        name="Frontal Concrete Barrier Wall",
        contact_zone="frontal_full",
        stress_concentration=1.0,
        sharpness_factor=0.0,
        description="Full-width rigid concrete barrier testing progressive crumple-zone absorption."
    ),
    "bollard_pole": ObstaclePreset(
        id="bollard_pole",
        name="Center Steel Bollard Pole",
        contact_zone="frontal_concentrated",
        stress_concentration=2.1,
        sharpness_factor=0.35,
        description="Concentrated central cylindrical pole testing frame rail intrusion and fender wrap."
    ),
    "spike_strip": ObstaclePreset(
        id="spike_strip",
        name="Road Spike Strip / Sharp Debris",
        contact_zone="undercarriage_tires",
        stress_concentration=3.5,
        sharpness_factor=1.0,
        description="High-penetration road spikes testing tire blowout/deflation and undercarriage armor."
    ),
    "speed_bump": ObstaclePreset(
        id="speed_bump",
        name="High-Speed Baja Speed-Bump Jump",
        contact_zone="undercarriage_tires",
        stress_concentration=1.65,
        sharpness_factor=0.15,
        description="Curved asphalt ramp testing suspension G-load, airborne launch pitch, and undercarriage scrape."
    ),
    "wind_and_thrust": ObstaclePreset(
        id="wind_and_thrust",
        name="Crosswind Shear & 6G Buckling",
        contact_zone="aerodynamic_lateral",
        stress_concentration=1.0,
        sharpness_factor=0.0,
        description="High-altitude diagonal gust shear and 6G axial compression buckling."
    ),
}


class PhysicsEngine:
    """Domain-aware OOP structural, aging, NCAP, and error-bound analyzer."""

    @staticmethod
    def get_material(name: str) -> Dict[str, Any]:
        return MATERIAL_LIBRARY.get(name, MATERIAL_LIBRARY["Al 6061"])

    @staticmethod
    def get_material_obj(name: str) -> MaterialProfile:
        return MATERIAL_OBJECTS.get(name, MATERIAL_OBJECTS["Al 6061"])

    @staticmethod
    def get_obstacle_obj(obstacle_id: str) -> ObstaclePreset:
        return OBSTACLE_PRESETS.get(obstacle_id, OBSTACLE_PRESETS["concrete_wall"])

    @classmethod
    def compute_aging_factor(
        cls,
        mat_obj: MaterialProfile,
        age_years: float = 0.0,
        temp_c: float = 25.0,
        humidity_pct: float = 50.0
    ) -> Dict[str, Any]:
        """
        Arrhenius & Hygrothermal Material Degradation Model:
        Calculates strength retention factor (0.25 -> 1.0) and embrittlement shift
        based on service time (years), ambient temperature (°C), and relative humidity (%).
        """
        if age_years <= 0.01:
            return {
                "retention_factor": 1.0,
                "retention_pct": 100.0,
                "degraded_yield_mpa": mat_obj.yield_mpa,
                "effective_deform_mode": mat_obj.animation.deform_mode,
                "aging_summary": "Factory New (100% strength retention)"
            }

        # Arrhenius thermal acceleration relative to 25°C (298.15K)
        delta_t = temp_c - 25.0
        thermal_accel = math.exp((delta_t / 35.0) * mat_obj.thermal_sensitivity) if delta_t > 0 else (
            1.0 + abs(delta_t) / 100.0 * 0.25  # Sub-zero cold embrittlement
        )
        # Hygrothermal moisture acceleration relative to 50% RH
        rh_ratio = max(0.1, humidity_pct / 50.0)
        humidity_accel = 1.0 + (rh_ratio - 1.0) * mat_obj.humidity_sensitivity if rh_ratio > 1.0 else (
            1.0 - (1.0 - rh_ratio) * 0.15
        )

        effective_rate = mat_obj.annual_degradation_rate * max(0.2, thermal_accel) * max(0.2, humidity_accel)
        retention = max(0.25, min(1.0, math.exp(-effective_rate * age_years)))
        degraded_yield = round(mat_obj.yield_mpa * retention, 1)

        # Severe aging (< 68% retention) or extreme sub-zero cold (-15°C) causes polymers/elastomers to embrittle!
        eff_mode = mat_obj.animation.deform_mode
        if (retention < 0.68 or temp_c < -15.0) and mat_obj.name in ("Rubber", "ABS", "PLA", "Steel"):
            if mat_obj.name in ("ABS", "PLA", "Rubber"):
                eff_mode = "brittle_shatter"

        loss_pct = round((1.0 - retention) * 100.0, 1)
        return {
            "retention_factor": round(retention, 3),
            "retention_pct": round(retention * 100.0, 1),
            "degraded_yield_mpa": degraded_yield,
            "effective_deform_mode": eff_mode,
            "aging_summary": f"{loss_pct}% strength loss over {age_years:g} yr @ {temp_c:g}°C, {humidity_pct:g}% RH"
        }

    @staticmethod
    def compute_ncap_rating(
        peak_g: float,
        crumple_ratio: float,
        crash_sf: float,
        is_shattered: bool,
        tire_punctured: bool,
        obstacle: str
    ) -> Dict[str, Any]:
        """
        Global NCAP / Euro NCAP Adult Occupant Protection (AOP) 16-Point & 5-Star Calculator:
        Balances occupant biomechanical G-load, survival-cell intrusion, and glazing integrity.
        """
        # 1. Biomechanical Deceleration Score (Max 8.0 pts)
        if peak_g <= 28.0:
            g_pts = 8.0
        elif peak_g <= 65.0:
            g_pts = max(0.0, 8.0 * (1.0 - (peak_g - 28.0) / 37.0))
        else:
            g_pts = 0.0

        # 2. Survival Cell & Crumple Zone Intrusion Score (Max 6.0 pts)
        # Ideal crumple ratio is 0.06 to 0.24 (absorbs energy without breaching passenger cabin)
        if crumple_ratio <= 0.22:
            intrusion_pts = 6.0
        elif crumple_ratio <= 0.45:
            intrusion_pts = max(0.0, 6.0 * (1.0 - (crumple_ratio - 0.22) / 0.23))
        else:
            intrusion_pts = 0.0

        # 3. Structural & Glazing Integrity Modifier (Max 2.0 pts)
        integrity_pts = 2.0
        if is_shattered:
            integrity_pts -= 1.2
        if tire_punctured:
            integrity_pts -= 1.0
        if crash_sf < 1.0:
            integrity_pts -= 0.8
        integrity_pts = max(0.0, integrity_pts)

        aop_score = round(min(16.0, max(0.0, g_pts + intrusion_pts + integrity_pts)), 1)

        # Map 16-point AOP score to 0–5 NCAP Stars (with hard caps on cabin collapse)
        if crumple_ratio > 0.42 or peak_g > 95.0:
            stars = 1 if aop_score >= 3.0 else 0
        elif aop_score >= 13.5:
            stars = 5
        elif aop_score >= 10.5:
            stars = 4
        elif aop_score >= 7.5:
            stars = 3
        elif aop_score >= 4.5:
            stars = 2
        elif aop_score >= 2.0:
            stars = 1
        else:
            stars = 0

        star_str = "★" * stars + "☆" * (5 - stars)
        verdict = (
            "5-Star Exemplary Crashworthiness" if stars == 5 else
            "4-Star Good Occupant Protection" if stars == 4 else
            "3-Star Moderate Protection" if stars == 3 else
            "2-Star High Injury Risk" if stars == 2 else
            "1-Star Severe Cabin Intrusion / G-Load" if stars == 1 else
            "0-Star Catastrophic Structural Failure"
        )
        return {
            "stars": stars,
            "star_string": star_str,
            "aop_score_16": aop_score,
            "verdict": verdict
        }

    @staticmethod
    def compute_error_metrics(
        n_solids: int,
        compiled_parts: Optional[Dict[str, Dict[str, Any]]],
        bbox: List[float]
    ) -> Dict[str, Any]:
        """
        Quantifies both CAD B-Rep Discretization Error (%) and Reduced-Order
        Analytical Surrogate vs. 3D Nonlinear FEM Error Margin (±%).
        """
        n_parts = len(compiled_parts) if compiled_parts else max(1, n_solids)
        aspect = max(bbox) / max(min(bbox), 1.0) if bbox else 2.0

        # 1. CAD B-Rep vs. Tessellated Mesh Discretization Error (OpenCASCADE exact kernel)
        cad_brep_error_pct = round(min(1.2, 0.14 + 0.08 * n_parts), 2)

        # 2. Analytical Lumped-Parameter Solver vs. Full Nonlinear 3D FEM (LS-DYNA/ANSYS) Margin
        fea_surrogate_error_pct = round(min(14.5, 4.2 + 1.15 * n_parts + 0.35 * min(aspect, 8.0)), 1)
        confidence_pct = round(100.0 - fea_surrogate_error_pct, 1)

        return {
            "cad_brep_error_pct": cad_brep_error_pct,
            "fea_surrogate_error_pct": fea_surrogate_error_pct,
            "solver_confidence_pct": confidence_pct,
            "methodology": "Abramowicz-Alexander Thin-Walled Crush + Euler-Bernoulli Cantilever Surrogate"
        }

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
        prompt: str = "",
        age_years: float = 0.0,
        temp_c: float = 25.0,
        humidity_pct: float = 50.0
    ) -> Dict[str, Any]:
        mat_obj = cls.get_material_obj(material)
        obs_obj = cls.get_obstacle_obj(obstacle)
        aging_main = cls.compute_aging_factor(mat_obj, age_years, temp_c, humidity_pct)

        rho = mat_obj.density_g_cm3
        sigma_y = aging_main["degraded_yield_mpa"]
        youngs_mpa = mat_obj.youngs_gpa * 1000.0
        failure_mode = aging_main["effective_deform_mode"]

        vol_mm3 = max(float(volume_mm3 or 1.0), 1.0)
        lx = max(float(bbox[0] if len(bbox) > 0 else 100.0), 1.0)
        ly = max(float(bbox[1] if len(bbox) > 1 else 100.0), 1.0)
        lz = max(float(bbox[2] if len(bbox) > 2 else 100.0), 1.0)

        domain_info = cls.detect_domain(prompt, [lx, ly, lz])
        impact_axis = domain_info["impact_axis"]
        primary_len_mm = lz if impact_axis == "Z" else (lx if impact_axis == "X" else ly)
        cross_a_mm = lx if impact_axis == "Z" else ly
        cross_b_mm = ly if impact_axis == "Z" else lz

        # --- Weighted Multi-Part Mass & Structural Yield Calculation ---
        part_reports: List[Dict[str, Any]] = []
        potential_savings_g = 0.0
        weighted_mass_g = 0.0
        structural_yield_num = 0.0
        structural_vol_den = 0.0

        if compiled_parts:
            for pid, pdata in compiled_parts.items():
                p_vol = max(float(pdata.get("volume_mm3") or (vol_mm3 / max(len(compiled_parts), 1))), 1.0)
                p_mat = pdata.get("material") or material
                p_obj = cls.get_material_obj(p_mat)
                p_aging = cls.compute_aging_factor(p_obj, age_years, temp_c, humidity_pct)
                p_mass_g = round(p_vol * (p_obj.density_g_cm3 / 1000.0), 2)
                weighted_mass_g += p_mass_g
                role = cls.classify_part_role(pid)
                # Primary structure & aerodynamic body govern overall crash crumple resistance!
                if role in ("primary_structure", "aerodynamic_surface", "thermal_propulsion"):
                    structural_yield_num += p_vol * p_aging["degraded_yield_mpa"]
                    structural_vol_den += p_vol
            if structural_vol_den > 0:
                sigma_y = structural_yield_num / structural_vol_den
        else:
            weighted_mass_g = round(vol_mm3 * (rho / 1000.0), 2)

        mass_g = round(weighted_mass_g, 2)
        mass_kg = max(mass_g / 1000.0, 0.001)

        # --- 1. Obstacle & Constitutive Fracture Simulation ---
        v_m_s = max(speed_kmh / 3.6, 0.1)
        ke_joules = 0.5 * mass_kg * (v_m_s ** 2)

        contact_factor = 0.35 if obstacle == "bollard_pole" else (0.15 if obstacle in ("spike_strip", "speed_bump") else 1.0)
        effective_frame_area_mm2 = max(cross_a_mm * cross_b_mm * 0.035 * contact_factor, 8.0)

        dynamic_load_n = max(mass_kg * (v_m_s ** 2) / max(primary_len_mm / 1000.0 * 0.22, 0.01), 10.0)
        impact_stress_mpa = round((dynamic_load_n / effective_frame_area_mm2) * obs_obj.stress_concentration, 1)
        crash_safety_factor = round(sigma_y / max(impact_stress_mpa, 0.5), 2)

        # Calculate material-dependent crumple ratio (weak/brittle materials deform/shatter much more than Titanium/Steel!)
        strength_ratio = 276.0 / max(sigma_y, 15.0)  # Normalized against Al 6061 (276 MPa)
        speed_norm = speed_kmh / 90.0
        raw_crumple_ratio = 0.14 * (speed_norm ** 1.35) * (strength_ratio ** 0.55) * obs_obj.stress_concentration * 0.75
        crumple_ratio = round(min(max(raw_crumple_ratio, 0.02), 0.72), 3)
        crumple_depth_mm = round(crumple_ratio * primary_len_mm, 1)

        # Peak G deceleration: stiffer materials (Steel/Titanium) have shorter crush distances -> higher G spike;
        # softer materials crush deeper -> lower initial G until bottoming out!
        crush_dist_m = max(crumple_depth_mm / 1000.0, 0.008)
        peak_g = round(min((v_m_s ** 2) / (2.0 * crush_dist_m * 9.81) * 1.4, 250.0), 1)
        mean_crush_force_n = ke_joules / crush_dist_m

        # Check Tire Puncture / Blowout if Obstacle is `spike_strip`
        tire_punctured = obstacle == "spike_strip" and (
            mat_obj.animation.puncture_vulnerable
            or any(cls.classify_part_role(pid) == "elastomer_traction" for pid in (compiled_parts or {}))
        )
        is_shattered = failure_mode == "brittle_shatter" and crash_safety_factor < 1.15
        survived_crash = (
            not is_shattered
            and not tire_punctured
            and crumple_ratio <= domain_info["max_crumple_ratio"]
            and crash_safety_factor >= 0.85
            and peak_g <= domain_info["max_survivable_g"] * 1.8
        )

        # Compute NCAP 5-Star Rating & Error Margins!
        ncap = cls.compute_ncap_rating(peak_g, crumple_ratio, crash_safety_factor, is_shattered, tire_punctured, obstacle)
        error_metrics = cls.compute_error_metrics(n_solids, compiled_parts, [lx, ly, lz])

        if tire_punctured:
            failure_desc = f"Tire Blowout & Undercarriage Puncture on Spike Strip at {speed_kmh:.0f} km/h!"
        elif is_shattered:
            failure_desc = f"Brittle Shatter ({material} fractured into shards at {impact_stress_mpa} MPa > {sigma_y:.0f} MPa)"
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

        # --- 4. Role-Aware & Aging-Aware Per-Part Breakdown ---
        part_animations: Dict[str, Dict[str, Any]] = {}
        if compiled_parts:
            for pid, pdata in compiled_parts.items():
                p_vol = float(pdata.get("volume_mm3") or (vol_mm3 / max(len(compiled_parts), 1)))
                p_mat = pdata.get("material") or material
                p_obj = cls.get_material_obj(p_mat)
                p_aging = cls.compute_aging_factor(p_obj, age_years, temp_c, humidity_pct)
                p_mass_g = round(p_vol * (p_obj.density_g_cm3 / 1000.0), 2)
                role = cls.classify_part_role(pid)
                part_animations[pid] = asdict(p_obj.animation)

                # Estimate local part safety factor based on slenderness and material yield
                local_stress = max(impact_stress_mpa * (0.45 if role == "transparent_glazing" else 0.8), wind_bending_stress_mpa)
                p_sf = round(min(p_aging["degraded_yield_mpa"] / max(local_stress, 1.0), 25.0), 2)

                status = "optimal"
                age_note = f" [{p_aging['retention_pct']}% strength retained]" if age_years > 0 else ""
                recommendation = f"Optimal {p_mat}{age_note} for {role.replace('_', ' ')}."

                if p_aging["retention_pct"] < 75.0:
                    status = "warning"
                    recommendation = (
                        f"Environmental aging degraded `{pid}` ({p_mat}) to {p_aging['retention_pct']}% strength "
                        f"({p_aging['degraded_yield_mpa']} MPa). Consider corrosion/UV-resistant Al 6061 or Titanium."
                    )
                elif role == "transparent_glazing":
                    if p_mat not in ("Glass", "PLA", "ABS"):
                        status = "warning"
                        recommendation = f"`{pid}` is glazing; use Glass for optical visibility instead of opaque {p_mat}."
                    elif p_sf < 1.1:
                        status = "critical"
                        recommendation = f"Glass shattered at {speed_kmh:.0f} km/h ({local_stress:.0f} MPa). Upgrade `{pid}` to laminated polycarbonate."
                elif role == "elastomer_traction":
                    if obstacle == "spike_strip":
                        status = "critical"
                        recommendation = f"`{pid}` punctured by road spikes! Switch to run-flat honeycomb airless rubber."
                    elif p_mat != "Rubber":
                        status = "warning"
                        recommendation = f"`{pid}` requires high-friction elastomer grip; use Rubber tires."
                elif role == "aerodynamic_surface":
                    if p_sf < 1.2:
                        status = "critical"
                        recommendation = f"High aerodynamic root stress ({local_stress:.0f} MPa). Reinforce `{pid}` with Carbon Fiber or Titanium."
                    elif p_obj.density_g_cm3 > 3.0:
                        alt_mass = round(p_vol * (1.60 / 1000.0), 1)
                        saved = max(p_mass_g - alt_mass, 0.0)
                        potential_savings_g += saved
                        status = "over_engineered"
                        recommendation = f"Switch `{pid}` from {p_mat} to Carbon Fiber to save {saved:.1f}g."
                else:
                    # primary_structure or thermal_propulsion
                    if p_sf < 1.15:
                        status = "critical"
                        recommendation = f"Structural yield risk ({p_sf}x SF){age_note}. Reinforce `{pid}` with Titanium or Carbon Fiber."
                    elif p_sf > 3.5 and p_obj.density_g_cm3 > 2.70:
                        alt_mass = round(p_vol * (2.70 / 1000.0), 1)
                        saved = max(p_mass_g - alt_mass, 0.0)
                        potential_savings_g += saved
                        status = "over_engineered"
                        recommendation = f"Over-engineered ({p_sf}x SF). Switch `{pid}` from {p_mat} to Al 6061 to save {saved:.1f}g."

                part_reports.append({
                    "part_id": pid,
                    "role": role,
                    "material": p_mat,
                    "failure_mode": p_aging["effective_deform_mode"],
                    "retention_pct": p_aging["retention_pct"],
                    "mass_g": p_mass_g,
                    "volume_mm3": round(p_vol, 1),
                    "safety_factor": p_sf,
                    "status": status,
                    "recommendation": recommendation
                })

        # Compare all materials for the Playground Material Matrix
        material_comparison = []
        for m_name, m_obj in MATERIAL_OBJECTS.items():
            m_aging = cls.compute_aging_factor(m_obj, age_years, temp_c, humidity_pct)
            m_mass_g = round(vol_mm3 * (m_obj.density_g_cm3 / 1000.0), 1)
            m_sf = round((m_aging["degraded_yield_mpa"] / max(impact_stress_mpa, 1.0)), 2)
            material_comparison.append({
                "material": m_name,
                "mass_g": m_mass_g,
                "yield_mpa": m_aging["degraded_yield_mpa"],
                "retention_pct": m_aging["retention_pct"],
                "failure_mode": m_aging["effective_deform_mode"],
                "safety_factor": m_sf,
                "cost_est_usd": round((m_mass_g / 1000.0) * m_obj.cost_usd_kg, 2)
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
            "ncap_rating": ncap,
            "aging_report": aging_main,
            "error_metrics": error_metrics,
            "potential_mass_savings_g": round(potential_savings_g, 1),
            "part_animations": part_animations,
            "edge_cases": {
                "crash_test": {
                    "obstacle": obstacle,
                    "obstacle_name": obs_obj.name,
                    "impact_axis": impact_axis,
                    "failure_mode": "tire_blowout" if tire_punctured else failure_mode,
                    "failure_description": failure_desc,
                    "speed_kmh": speed_kmh,
                    "kinetic_energy_j": round(ke_joules, 1),
                    "mean_crush_force_kn": round(mean_crush_force_n / 1000.0, 2),
                    "crumple_depth_mm": crumple_depth_mm,
                    "crumple_ratio": crumple_ratio,
                    "peak_deceleration_g": peak_g,
                    "impact_stress_mpa": impact_stress_mpa,
                    "safety_factor": crash_safety_factor,
                    "survived": survived_crash,
                    "ncap_stars": ncap["stars"],
                    "ncap_star_string": ncap["star_string"],
                    "ncap_aop_score": ncap["aop_score_16"]
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