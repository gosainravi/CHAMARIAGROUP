"""AI-assisted placement suggestions. The user always reviews and accepts/rejects each suggestion.

With ANTHROPIC_API_KEY set, a Claude vision model reads the floor plan. Without it, a simple rule-based
fallback proposes a Wi-Fi AP grid over the drawn area so the feature still works offline.
"""
from __future__ import annotations

import base64
import io
import json
import os
import re

from PIL import Image, ImageOps

MODEL = os.getenv("INFRA_AI_MODEL", "claude-sonnet-5-5")
MAX_SIDE = 1568

PROMPT = """You are an experienced IT infrastructure designer. This image is an architectural floor plan
({w} x {h} px, scale {scale}). Propose where to place IT equipment for a typical office/industrial fit-out:
- Wi-Fi APs (symbol AP): about one per 150-250 m² indoors, ceiling-centre of rooms/halls, not on walls.
- Dome cameras (CAM) at entries, corridors, stair cores, reception; bullet cameras (BUL) for outdoor perimeter/gates.
- User LAN points (LAN) at desks/cabins (1-2 per cabin, 1 per workstation), IP phones (PH) in cabins/reception.
- Printers (PR) in open office areas; biometric (BIO) at main staff entry; access-control doors (ACD) at server room / MD cabin.
- One network rack (RK) per floor zone so that cable runs stay under 90 m, placed in a server/electrical/store room.
Only use these symbols: {symbols}.
Return ONLY JSON: {{"suggestions":[{{"symbol":"AP","x":0.42,"y":0.31,"room":"Reception","reason":"..."}}]}}
x and y are fractions (0-1) of image width/height. Read room names from the drawing where legible.
Limit to the {limit} most useful suggestions. {focus}"""


def _image_b64(path: str) -> tuple[str, int, int]:
    img = Image.open(path).convert("RGB")
    img.thumbnail((MAX_SIDE, MAX_SIDE))
    b = io.BytesIO()
    img.save(b, "PNG")
    return base64.b64encode(b.getvalue()).decode(), img.width, img.height


def suggest_ai(layout, symbols: list[str], focus: str = "", limit: int = 60) -> list[dict]:
    import anthropic

    data, w, h = _image_b64(layout.image_path)
    scale = f"1 m = {1 / layout.scale_m_per_px:.1f} px of the original" if layout.scale_m_per_px else "unknown"
    client = anthropic.Anthropic()
    msg = client.messages.create(
        model=MODEL, max_tokens=8000,
        messages=[{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": data}},
            {"type": "text", "text": PROMPT.format(w=w, h=h, scale=scale, symbols=", ".join(symbols), limit=limit,
                                                   focus=f"Focus on: {focus}." if focus else "")},
        ]}],
    )
    text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise ValueError("The AI response had no JSON")
    out = []
    for s in json.loads(m.group(0)).get("suggestions", []):
        try:
            x, y = float(s["x"]), float(s["y"])
        except (KeyError, TypeError, ValueError):
            continue
        if s.get("symbol") in symbols and 0 <= x <= 1 and 0 <= y <= 1:
            out.append({"symbol": s["symbol"], "x": x * layout.width, "y": y * layout.height,
                        "room": str(s.get("room", ""))[:100], "reason": str(s.get("reason", ""))[:200], "source": "ai"})
    return out


def suggest_grid(layout, spacing_m: float = 15) -> list[dict]:
    """Fallback: AP grid over the non-white bounding box of the drawing."""
    img = Image.open(layout.image_path).convert("L")
    bbox = ImageOps.invert(img).point(lambda v: 255 if v > 40 else 0).getbbox()
    if not bbox:
        return []
    x0, y0, x1, y1 = bbox
    step = spacing_m / layout.scale_m_per_px if layout.scale_m_per_px else max(x1 - x0, y1 - y0) / 4
    out = []
    y = y0 + step / 2
    while y < y1:
        x = x0 + step / 2
        while x < x1:
            out.append({"symbol": "AP", "x": x, "y": y, "room": "",
                        "reason": f"Grid every {spacing_m:.0f} m" if layout.scale_m_per_px else "Grid (set scale for real spacing)",
                        "source": "rule"})
            x += step
        y += step
    return out[:80]
