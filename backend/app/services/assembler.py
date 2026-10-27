"""
Parametric Multi-Part B-Rep Assembler with Native XCAF Color Support.

Encapsulates individual verified sub-part CadQuery scripts into isolated
Python functions, applies spatial (X, Y, Z) translations, and produces a
single self-contained master CadQuery script that defines:
- `parts`: Dict[str, cq.Workplane] for multi-part 3D viewer mesh segmentation
- `part_colors`: Dict[str, str] mapping part_id -> hex color
- `cad_assembly`: cq.Assembly with embedded `cq.Color(r, g, b, a)` for colored STEP export
- `result`: cq.Compound for STL export and B-Rep volume/mass calculation
"""
import re
from typing import Dict, Any, List, Tuple


class CadAssembler:
    """Stitches verified sub-part scripts into a clean master assembly script."""

    @staticmethod
    def sanitize_identifier(raw_id: str) -> str:
        clean = re.sub(r"[^a-zA-Z0-9_]", "_", str(raw_id or "part").strip().lower())
        if not clean or clean[0].isdigit():
            clean = f"part_{clean}"
        return clean

    @staticmethod
    def hex_to_rgba(hex_str: str, is_glass: bool = False) -> Tuple[float, float, float, float]:
        """Converts a '#RRGGBB' hex string into normalized (r, g, b, a) floats in [0.0, 1.0]."""
        h = str(hex_str or "#94a3b8").lstrip("#").strip()
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        try:
            r = int(h[0:2], 16) / 255.0
            g = int(h[2:4], 16) / 255.0
            b = int(h[4:6], 16) / 255.0
        except ValueError:
            r, g, b = 0.58, 0.64, 0.72
        alpha = 0.45 if is_glass else 1.0
        return (round(r, 3), round(g, 3), round(b, 3), alpha)

    @classmethod
    def stitch_assembly(
        cls,
        compiled_parts: Dict[str, Dict[str, Any]],
        bom_parts: List[Dict[str, Any]]
    ) -> str:
        """
        Wraps each sub-part's code inside `def _build_<id>():` and combines
        them into `parts = {...}`, `part_colors = {...}`, `cad_assembly = cq.Assembly()`,
        and `result = ...`.
        """
        if not compiled_parts:
            return ""

        # Single-part shortcut: if only 1 part and no translation needed, return its code directly
        if len(compiled_parts) == 1:
            only_id, only_data = next(iter(compiled_parts.items()))
            pos = only_data.get("translate_mm") or [0.0, 0.0, 0.0]
            code = only_data.get("code", "").strip()
            if pos == [0.0, 0.0, 0.0] or pos == [0, 0, 0]:
                return code + "\n"

        lines: List[str] = [
            "import math",
            "import cadquery as cq",
            "",
            "# ======================================================================",
            "# BREPLINE MODULAR MULTI-PART ASSEMBLY (WITH XCAF STEP COLORS)",
            "# ======================================================================",
            ""
        ]

        part_order: List[str] = []
        pos_map: Dict[str, List[float]] = {}
        color_map: Dict[str, str] = {}

        for bp in bom_parts:
            pid = bp.get("id") or bp.get("part_id")
            if pid and pid in compiled_parts:
                part_order.append(pid)
                pos_map[pid] = bp.get("position_mm") or bp.get("translate_mm") or [0.0, 0.0, 0.0]
                color_map[pid] = bp.get("color_hex") or compiled_parts[pid].get("color_hex") or "#94a3b8"

        for pid in compiled_parts:
            if pid not in part_order:
                part_order.append(pid)
                pos_map[pid] = compiled_parts[pid].get("translate_mm") or [0.0, 0.0, 0.0]
                color_map[pid] = compiled_parts[pid].get("color_hex") or "#94a3b8"

        func_map: Dict[str, str] = {}

        for pid in part_order:
            pdata = compiled_parts[pid]
            safe_id = cls.sanitize_identifier(pid)
            fn_name = f"_build_{safe_id}"
            func_map[pid] = fn_name

            raw_sub_code = (pdata.get("code") or "").strip()
            body_lines = []
            for ln in raw_sub_code.splitlines():
                stripped = ln.strip()
                # Omit redundant top-level imports inside the inner function
                if stripped in ("import cadquery as cq", "import math"):
                    continue
                body_lines.append("    " + ln if ln.strip() else "")

            lines.append(f"def {fn_name}():")
            if body_lines:
                lines.extend(body_lines)
            else:
                lines.append("    result = cq.Workplane('XY').box(10, 10, 10)")
            lines.append("    return result")
            lines.append("")

        lines.append("# --- Assemble & Translate Sub-Parts into World Coordinates ---")
        lines.append("parts = {}")
        lines.append("part_colors = {}")
        lines.append("cad_assembly = cq.Assembly()")

        for pid in part_order:
            fn_name = func_map[pid]
            pdata = compiled_parts[pid]
            pos = pos_map.get(pid) or [0.0, 0.0, 0.0]
            bmin = pdata.get("bbox_min") or [0.0, 0.0, 0.0]
            tx = float(pos[0]) if len(pos) > 0 else 0.0
            ty = float(pos[1]) if len(pos) > 1 else 0.0
            tz = float(pos[2]) if len(pos) > 2 else 0.0

            # Anti-Double-Translation Guard: if the sub-part script already placed its base at `tz` (e.g. bmin[2] >= tz * 0.8),
            # do not add `tz` a second time!
            if tz > 10.0 and len(bmin) > 2 and float(bmin[2]) >= tz * 0.75:
                tz = 0.0
            if abs(tx) > 10.0 and len(bmin) > 0 and abs(float(bmin[0]) - tx) < abs(tx) * 0.35:
                tx = 0.0

            if abs(tx) > 1e-6 or abs(ty) > 1e-6 or abs(tz) > 1e-6:
                lines.append(f"parts[{pid!r}] = {fn_name}().translate(({tx}, {ty}, {tz}))")
            else:
                lines.append(f"parts[{pid!r}] = {fn_name}()")

            hex_col = color_map.get(pid, "#94a3b8")
            is_glass = any(w in pid.lower() for w in ("glass", "window", "windshield", "canopy")) or hex_col.lower() == "#38bdf8"
            r, g, b, a = cls.hex_to_rgba(hex_col, is_glass=is_glass)
            lines.append(f"part_colors[{pid!r}] = {hex_col!r}")
            lines.append(f"cad_assembly.add(parts[{pid!r}], name={pid!r}, color=cq.Color({r}, {g}, {b}, {a}))")

        lines.append("")
        lines.append("# --- Combine into Master Solid / Compound for Export ---")
        lines.append("_solids = []")
        lines.append("for _p in parts.values():")
        lines.append("    _solids.append(_p.val() if hasattr(_p, 'val') else _p)")
        lines.append("result = cq.Compound.makeCompound(_solids)")
        lines.append("")

        return "\n".join(lines)