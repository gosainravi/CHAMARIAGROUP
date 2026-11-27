"""Room labels for a layout image: exact text from the drawing (DXF text / PDF text layer) plus OCR for names
drawn as lines or scanned. Stored next to the rendered PNG as <png>.meta.json, together with the auto scale."""
from __future__ import annotations

import json
import re
from pathlib import Path

NOISE = re.compile(r"notes?\b|dimension|drawing|architect|contractor|client|project|designer|revised|purpose|"
                   r"construction|advance copy|north|information|furniture|layout|split ?a\.?c|tower|pitampura|"
                   r"scale\b|\bdate\b|consult|signature|approved|checked|drawn|sheet|title|legend|mathura|chhata|"
                   r"evolve|millimet|verified|discrepanc|responsib", re.I)


def clean(text: str) -> str | None:
    t = " ".join(str(text).replace("\\P", " ").split())
    t = re.sub(r"^[^A-Za-z0-9]+|[^A-Za-z0-9')]+$", "", t)
    letters = [c for c in t if c.isalpha()]
    if not (3 <= len(t) <= 40) or len(letters) < 3 or len(letters) < len(t) * 0.55:
        return None
    if NOISE.search(t):
        return None
    if sum(c.isupper() for c in letters) < len(letters) * 0.7 and not re.search(r"biomatrix|printer", t, re.I):
        return None  # room names on drawings are upper case; mixed case is usually notes / OCR noise
    return t


def merge(exact: list[dict], ocr: list[dict], near_px: float) -> list[dict]:
    out = list(exact)
    for o in ocr:
        if not any(abs(o["x"] - e["x"]) < near_px and abs(o["y"] - e["y"]) < near_px for e in out):
            out.append(o)
    return out


def meta_path(png: str | Path) -> Path:
    return Path(str(png) + ".meta.json")


def save_meta(png: Path, labels: list[dict], scale: float | None):
    meta_path(png).write_text(json.dumps({"labels": labels, "scale_m_per_px": scale}), encoding="utf-8")


def load_meta(png: str | Path) -> dict | None:
    p = meta_path(png)
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def ocr_labels(png: Path) -> list[dict]:
    from .ocr import ocr_image
    out = []
    try:
        for text, x, y, _h in ocr_image(png, 1.5):
            t = clean(text)
            if t:
                out.append({"text": t, "x": round(x, 1), "y": round(y, 1), "src": "ocr"})
    except Exception:  # noqa: BLE001 — OCR is best effort
        return []
    return out


def build(png: Path, exact_raw: list[dict], scale: float | None, width: int) -> list[dict]:
    exact = []
    for e in exact_raw:
        t = clean(e["text"])
        if t:
            exact.append({**e, "text": t})
    labels = merge(exact, ocr_labels(png), near_px=width / 150)
    save_meta(png, labels, scale)
    return labels
