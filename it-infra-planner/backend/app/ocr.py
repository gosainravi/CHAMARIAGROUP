"""Read text from a rendered drawing with the Windows built-in OCR engine (no download, no cloud).

Used for drawings whose room names are geometry (exploded text in DXF, scanned PDFs). Returns [] when
the OCR engine is not available (non-Windows hosts)."""
from __future__ import annotations

import asyncio
from pathlib import Path

from PIL import Image

TILE = 2400   # px per OCR tile (engine max is ~10000, smaller tiles read small text better)
OVERLAP = 200


async def _ocr_tile(engine, img: Image.Image):
    from winrt.windows.graphics.imaging import SoftwareBitmap, BitmapPixelFormat, BitmapAlphaMode
    from winrt.windows.storage.streams import DataWriter
    rgba = img.convert("RGBA")
    # SoftwareBitmap wants BGRA8
    r, g, b, a = rgba.split()
    data = Image.merge("RGBA", (b, g, r, a)).tobytes()
    w = DataWriter()
    w.write_bytes(list(data) if False else data)
    buf = w.detach_buffer()
    sb = SoftwareBitmap.create_copy_from_buffer(buf, BitmapPixelFormat.BGRA8, rgba.width, rgba.height, BitmapAlphaMode.PREMULTIPLIED)
    res = await engine.recognize_async(sb)
    out = []
    for line in res.lines:
        words = list(line.words)
        if not words:
            continue
        xs = [wd.bounding_rect.x for wd in words] + [wd.bounding_rect.x + wd.bounding_rect.width for wd in words]
        ys = [wd.bounding_rect.y for wd in words] + [wd.bounding_rect.y + wd.bounding_rect.height for wd in words]
        out.append((line.text, (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, max(ys) - min(ys)))
    return out


async def _ocr(path: Path, upscale: float):
    from winrt.windows.media.ocr import OcrEngine
    engine = OcrEngine.try_create_from_user_profile_languages()
    if engine is None:
        return []
    img = Image.open(path).convert("L")
    if upscale != 1:
        img = img.resize((int(img.width * upscale), int(img.height * upscale)), Image.LANCZOS)
    found = []
    step = TILE - OVERLAP
    for y0 in range(0, max(1, img.height - OVERLAP), step):
        for x0 in range(0, max(1, img.width - OVERLAP), step):
            tile = img.crop((x0, y0, min(img.width, x0 + TILE), min(img.height, y0 + TILE)))
            for text, cx, cy, h in await _ocr_tile(engine, tile):
                found.append((text, (x0 + cx) / upscale, (y0 + cy) / upscale, h / upscale))
    # drop duplicates from tile overlaps
    uniq = []
    for t in found:
        if not any(u[0] == t[0] and abs(u[1] - t[1]) < 30 and abs(u[2] - t[2]) < 30 for u in uniq):
            uniq.append(t)
    return uniq


def ocr_image(path: Path, upscale: float = 1.0) -> list[tuple[str, float, float, float]]:
    """[(text, x, y, height)] in image pixels."""
    try:
        import winrt.windows.media.ocr  # noqa: F401
    except ImportError:
        return []
    return asyncio.run(_ocr(Path(path), upscale))
