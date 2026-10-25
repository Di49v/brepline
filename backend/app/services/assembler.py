"""
Parametric Multi-Part B-Rep Assembler.

Encapsulates individual verified sub-part CadQuery scripts into isolated
Python functions, applies spatial (X, Y, Z) translations, and produces a
single self-contained master CadQuery script that defines both `parts`
(for multi-part 3D viewer coloring/inspection) and `result` (for STEP/STL export).
"""
import re
from typing import Dict, Any, List


class CadAssembler:
    """Stitches verified sub-part scripts into a clean master assembly script."""

    @staticmethod
    def sanitize_identifier(raw_id: str) -> str:
        clean = re.sub(r"[^a-zA-Z0-9_]", "_", str(raw_id or "part").strip().lower())
        if not clean or clean[0].isdigit():
            clean = f"part_{clean}"
        return clean

    @classmethod
    def stitch_assembly(
        cls,
        compiled_parts: Dict[str, Dict[str, Any]],
        bom_parts: List[Dict[str, Any]]
    ) -> str:
        """
        Wraps each sub-part's code inside `def _build_<id>():` and combines
        them into `parts = {...}` and `result = ...`.
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
            "# BREPLINE MODULAR MULTI-PART ASSEMBLY",
            "# Each sub-component is encapsulated in its own namespace and cached.",
            "# ======================================================================",
            ""
        ]

        part_order: List[str] = []
        pos_map: Dict[str, List[float]] = {}

        for bp in bom_parts:
            pid = bp.get("id") or bp.get("part_id")
            if pid and pid in compiled_parts:
                part_order.append(pid)
                pos_map[pid] = bp.get("position_mm") or bp.get("translate_mm") or [0.0, 0.0, 0.0]

        for pid in compiled_parts:
            if pid not in part_order:
                part_order.append(pid)
                pos_map[pid] = compiled_parts[pid].get("translate_mm") or [0.0, 0.0, 0.0]

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
        for pid in part_order:
            fn_name = func_map[pid]
            pos = pos_map.get(pid) or [0.0, 0.0, 0.0]
            tx = float(pos[0]) if len(pos) > 0 else 0.0
            ty = float(pos[1]) if len(pos) > 1 else 0.0
            tz = float(pos[2]) if len(pos) > 2 else 0.0
            if abs(tx) > 1e-6 or abs(ty) > 1e-6 or abs(tz) > 1e-6:
                lines.append(f"parts[{pid!r}] = {fn_name}().translate(({tx}, {ty}, {tz}))")
            else:
                lines.append(f"parts[{pid!r}] = {fn_name}()")

        lines.append("")
        lines.append("# --- Combine into Master Solid / Compound for Export ---")
        lines.append("_solids = []")
        lines.append("for _p in parts.values():")
        lines.append("    _solids.append(_p.val() if hasattr(_p, 'val') else _p)")
        lines.append("result = cq.Compound.makeCompound(_solids)")
        lines.append("")

        return "\n".join(lines)