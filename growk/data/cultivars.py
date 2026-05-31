"""
Cultivar Registry — the Network Knowledge layer (see ../cultivars/README.md and
../NEXTGEN-ARCHITECTURE.md §1).

Loads versioned cultivar/species protocols from `growk/cultivars/*.json` once at
import. A cultivar inherits its bands from a species and overrides per-metric; the
resolver walks that chain. Unknown ids resolve to None so callers can fall back to the
legacy CROP_DATABASE — this module never imports the prompt engine, to stay
dependency-free and avoid an import cycle.

The brand sells *cultivar* (Basilico Genovese DOP), not *crop* (basil). This registry
is where the Brain's "knowing" lives, and the asset that sharpens with every grow.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

_CULTIVARS_DIR = Path(__file__).resolve().parent.parent / "cultivars"
_STAGES = ("seedling", "vegetative", "flowering", "fruiting")
_DEFAULT_STAGE = "vegetative"
_METRICS = ("ph", "ec", "water_temp")


def _load_all() -> dict[str, dict]:
    registry: dict[str, dict] = {}
    if not _CULTIVARS_DIR.exists():
        return registry
    for path in sorted(_CULTIVARS_DIR.rglob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        cid = data.get("id")
        if isinstance(cid, str) and cid:
            registry[cid] = data
    return registry


# Loaded once at import. Restart the process to pick up edited protocol files.
_REGISTRY: dict[str, dict] = _load_all()


def band_width(metric: dict) -> float:
    """Absolute half-width of a tolerance band, percent or absolute."""
    if metric.get("tolerance_mode") == "percent":
        return float(metric["target"]) * float(metric["tolerance"]) / 100.0
    return float(metric["tolerance"])


def metric_band(metric: dict) -> tuple[float, float]:
    w = band_width(metric)
    return (float(metric["target"]) - w, float(metric["target"]) + w)


def get_record(cultivar_or_crop_id: str) -> Optional[dict]:
    return _REGISTRY.get(cultivar_or_crop_id)


def all_ids() -> list[str]:
    return sorted(_REGISTRY.keys())


def _inheritance_chain(cultivar_or_crop_id: str) -> list[dict]:
    """Root species first, leaf cultivar last. Cycle-safe."""
    chain: list[dict] = []
    seen: set[str] = set()
    cur = _REGISTRY.get(cultivar_or_crop_id)
    while cur is not None and cur["id"] not in seen:
        chain.append(cur)
        seen.add(cur["id"])
        parent_id = cur.get("inherits")
        cur = _REGISTRY.get(parent_id) if parent_id else None
    chain.reverse()
    return chain


def resolve_stage(cultivar_or_crop_id: str, stage: str = _DEFAULT_STAGE) -> Optional[dict]:
    """Merged stage bands following the inherits chain. None if id unknown."""
    if cultivar_or_crop_id not in _REGISTRY:
        return None
    stage = stage if stage in _STAGES else _DEFAULT_STAGE
    merged: dict = {}
    for node in _inheritance_chain(cultivar_or_crop_id):
        node_stage = (node.get("stages") or {}).get(stage, {})
        for metric, target in node_stage.items():
            merged[metric] = target
    return merged or None


def targets_for(cultivar_or_crop_id: str, stage: str = _DEFAULT_STAGE) -> Optional[dict]:
    """
    Legacy-shaped target ranges {"pH": (min,max), "EC": (min,max), ...} derived from
    the resolved bands, for drop-in compatibility with get_crop_targets / CROP_DATABASE.
    None if the id is unknown.
    """
    bands = resolve_stage(cultivar_or_crop_id, stage)
    if not bands:
        return None
    out: dict = {}
    if "ph" in bands:
        lo, hi = metric_band(bands["ph"])
        out["pH"] = (round(lo, 2), round(hi, 2))
    if "ec" in bands:
        lo, hi = metric_band(bands["ec"])
        out["EC"] = (round(lo), round(hi))
        # TDS is derived (~EC * 0.6) — kept for callers that still read it.
        out["TDS"] = (round(lo * 0.6), round(hi * 0.6))
    if "water_temp" in bands:
        lo, hi = metric_band(bands["water_temp"])
        out["water_temp"] = (round(lo, 1), round(hi, 1))
    return out or None


def _fmt_band(metric: dict, digits: int = 1) -> str:
    lo, hi = metric_band(metric)
    return f"{lo:.{digits}f}–{hi:.{digits}f} (target {float(metric['target']):.{digits}f})"


def protocol_block(cultivar_or_crop_id: str, stage: str = _DEFAULT_STAGE) -> Optional[str]:
    """
    Render the cultivar's knowledge as a prompt section. Returns None if the id is
    unknown (caller keeps the legacy crop prose). This is the per-cycle, dynamic
    knowledge layer — it belongs in the USER prompt, not the cached SYSTEM prompt.
    """
    rec = _REGISTRY.get(cultivar_or_crop_id)
    if rec is None:
        return None
    stage = stage if stage in _STAGES else _DEFAULT_STAGE
    bands = resolve_stage(cultivar_or_crop_id, stage) or {}

    name = rec.get("cultivar") or rec.get("id")
    lines = [f"## Cultivar Protocol — {name} (stage: {stage})"]

    provenance = rec.get("provenance")
    if provenance:
        lines.append(f"  Provenance: {provenance}")
    version = rec.get("protocol_version")
    if version is not None:
        lines.append(f"  Protocol version: {version}")

    if bands:
        lines.append("  Stage target bands (steer toward target; act on sustained exit):")
        if "ph" in bands:
            lines.append(f"    pH:         {_fmt_band(bands['ph'], 2)}")
        if "ec" in bands:
            lines.append(f"    EC:         {_fmt_band(bands['ec'], 0)} μS/cm")
        if "water_temp" in bands:
            lines.append(f"    Water temp: {_fmt_band(bands['water_temp'], 1)} °C")

    stress = rec.get("stress_signatures") or []
    if stress:
        lines.append("  Stress signatures (how this cultivar shows distress — read the plant):")
        lines.extend(f"    - {s}" for s in stress)

    markers = rec.get("harvest_markers") or []
    if markers:
        lines.append("  Harvest readiness (plant-led):")
        lines.extend(f"    - {m}" for m in markers)

    story = (rec.get("story") or {}).get("en")
    if story:
        lines.append(f"  Provenance note: {story}")

    return "\n".join(lines)
