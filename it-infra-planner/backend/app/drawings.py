"""Turn an uploaded drawing (PDF/JPG/PNG/DXF/DWG) into one PNG per page/sheet for the editor."""
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image

MAX_PX = 6000  # longest side of the rendered image
ALLOWED = {".pdf", ".jpg", ".jpeg", ".png", ".dxf", ".dwg"}


class DrawingError(Exception):
    pass


def _fit(w: float, h: float, target: int = 4000) -> float:
    return min(target / max(w, h), MAX_PX / max(w, h))


def render(src: Path, out_dir: Path) -> list[tuple[Path, int, int, str]]:
    """Returns [(png_path, width, height, sheet_name, scale_m_per_px or None)]; room labels go to <png>.meta.json."""
    ext = src.suffix.lower()
    if ext not in ALLOWED:
        raise DrawingError(f"Unsupported file type {ext}. Use PDF, JPG, PNG, DXF or DWG.")
    out_dir.mkdir(parents=True, exist_ok=True)
    from . import labels as L
    if ext in (".jpg", ".jpeg", ".png"):
        png, w, h, name = _raster(src, out_dir)
        L.build(png, [], None, w)
        return [(png, w, h, name, None)]
    if ext == ".pdf":
        out = []
        for i, (png, w, h, name) in enumerate(_pdf(src, out_dir)):
            raw = [{**x, "src": "pdf"} for x in pdf_room_labels(str(src), i, w)]
            L.build(png, raw, None, w)
            out.append((png, w, h, name, None))
        return out
    if ext == ".dwg":
        src = dwg_to_dxf(src, out_dir)
    png, w, h, name, raw, scale = _dxf(src, out_dir)
    L.build(png, raw, scale, w)
    return [(png, w, h, name, scale)]


def _raster(src: Path, out_dir: Path):
    img = Image.open(src)
    img = img.convert("RGB")
    if max(img.size) > MAX_PX:
        img.thumbnail((MAX_PX, MAX_PX))
    out = out_dir / "page-1.png"
    img.save(out, optimize=True)
    return out, img.width, img.height, src.stem


def _pdf(src: Path, out_dir: Path):
    import pymupdf

    res = []
    try:
        doc = pymupdf.open(src)
    except Exception as e:  # noqa: BLE001
        raise DrawingError(f"Could not open PDF: {e}") from e
    for i, page in enumerate(doc):
        z = _fit(page.rect.width, page.rect.height)
        pix = page.get_pixmap(matrix=pymupdf.Matrix(z, z), alpha=False)
        out = out_dir / f"page-{i + 1}.png"
        pix.save(out)
        res.append((out, pix.width, pix.height, f"Page {i + 1}"))
    if not res:
        raise DrawingError("PDF has no pages.")
    return res


def _dxf(src: Path, out_dir: Path, max_px: int = 6000):
    """Render DXF model space to PNG.

    ezdxf records the geometry (fast even for 100k+ elements); Pillow rasterises it. The PyMuPDF raster path
    was far too slow on large architectural DXFs (minutes), so it is not used."""
    from ezdxf import recover
    from ezdxf.addons.drawing import Frontend, RenderContext, config
    from ezdxf.addons.drawing.recorder import Recorder, PointsRecord, SolidLinesRecord, PathRecord, FilledPathsRecord
    from PIL import ImageDraw

    try:
        doc, _ = recover.readfile(str(src))
    except Exception as e:  # noqa: BLE001
        raise DrawingError(f"Could not read DXF: {e}") from e
    cfg = config.Configuration(background_policy=config.BackgroundPolicy.WHITE, color_policy=config.ColorPolicy.BLACK,
                               hatch_policy=config.HatchPolicy.SHOW_OUTLINE,
                               proxy_graphic_policy=config.ProxyGraphicPolicy.IGNORE)
    rec = Recorder()
    Frontend(RenderContext(doc), rec, config=cfg).draw_layout(doc.modelspace())
    player = rec.player()
    if not player.records:
        raise DrawingError("The DXF model space is empty.")
    bb = player.bbox()
    w_u, h_u = bb.extmax.x - bb.extmin.x, bb.extmax.y - bb.extmin.y
    if w_u <= 0 or h_u <= 0:
        raise DrawingError("The DXF has no drawable extent.")
    pad = 40
    k = (max_px - 2 * pad) / max(w_u, h_u)
    W, H = int(w_u * k) + 2 * pad, int(h_u * k) + 2 * pad
    img = Image.new("L", (W, H), 255)
    d = ImageDraw.Draw(img)
    x0, y1 = bb.extmin.x, bb.extmax.y
    flat = 1 / k  # flatten curves to ~1 output pixel

    def px(v):
        return ((v.x - x0) * k + pad, (y1 - v.y) * k + pad)

    for r, _props in player.recordings():
        if isinstance(r, SolidLinesRecord):
            pts = [px(v) for v in r.lines.vertices()]
            for i in range(0, len(pts) - 1, 2):
                d.line([pts[i], pts[i + 1]], fill=0)
        elif isinstance(r, PathRecord):
            pts = [px(v) for v in r.path.flattening(flat)]
            if len(pts) > 1:
                d.line(pts, fill=0)
        elif isinstance(r, FilledPathsRecord):
            for pth in r.paths:
                pts = [px(v) for v in pth.flattening(flat)]
                if len(pts) > 1:
                    d.line(pts + [pts[0]], fill=60)
        elif isinstance(r, PointsRecord):
            pts = [px(v) for v in r.points.vertices()]
            if len(pts) == 1:
                d.point(pts[0], fill=0)
            elif len(pts) > 1:
                d.polygon(pts, outline=0)
    out = out_dir / "page-1.png"
    img.convert("RGB").save(out, optimize=True)

    # exact text labels (TEXT / MTEXT, also inside blocks) in image pixels
    raw = []

    def walk(ents, depth):
        for e in ents:
            t = e.dxftype()
            try:
                if t == "TEXT":
                    raw.append((e.dxf.text, e.dxf.insert))
                elif t == "MTEXT":
                    raw.append((e.plain_text(), e.dxf.insert))
                elif t == "INSERT" and depth < 4:
                    walk(e.virtual_entities(), depth + 1)
            except Exception:  # noqa: BLE001 — broken blocks are skipped
                continue

    walk(doc.modelspace(), 0)
    labels = []
    for text, ins in raw:
        first = next((ln for ln in str(text).split("\n") if ln.strip()), "")
        full = " ".join(str(text).split())
        x, y = px(ins)
        if 0 <= x <= W and 0 <= y <= H:
            labels.append({"text": full if len(full) <= 40 else first, "x": round(x, 1), "y": round(y, 1), "src": "dxf"})
    units = {1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1.0, 14: 0.1}
    u = units.get(int(doc.header.get("$INSUNITS", 0) or 0))
    if u is None and max(w_u, h_u) > 5000:
        u = 0.001  # unitless architectural drawings are almost always millimetres
    scale = (u / k) if u else None
    if scale:  # drawings often declare the wrong unit (e.g. metres while drawn in mm): keep the result plausible
        width_m = W * scale
        if width_m > 3000:
            scale /= 1000
        elif width_m < 2:
            scale *= 1000
    return out, W, H, "Model", labels, scale


def find_oda() -> str | None:
    cand = [os.getenv("ODA_CONVERTER", "")]
    for base in (r"C:\Program Files\ODA", r"C:\Program Files (x86)\ODA"):
        if os.path.isdir(base):
            for d in sorted(os.listdir(base), reverse=True):
                cand.append(os.path.join(base, d, "ODAFileConverter.exe"))
    cand.append(shutil.which("ODAFileConverter") or "")
    return next((c for c in cand if c and os.path.isfile(c)), None)


def dwg_to_dxf(src: Path, out_dir: Path) -> Path:
    exe = find_oda()
    if not exe:
        raise DrawingError(
            "DWG needs the free ODA File Converter on the server "
            "(https://www.opendesign.com/guestfiles/oda_file_converter). "
            "Install it or set ODA_CONVERTER, or upload a DXF/PDF export instead."
        )
    with tempfile.TemporaryDirectory() as tin, tempfile.TemporaryDirectory() as tout:
        shutil.copy(src, tin)
        subprocess.run([exe, tin, tout, "ACAD2018", "DXF", "0", "1", "*.DWG"],
                       check=False, timeout=180, capture_output=True)
        dxfs = list(Path(tout).glob("*.dxf"))
        if not dxfs:
            raise DrawingError("ODA File Converter could not convert this DWG.")
        dst = out_dir / (src.stem + ".dxf")
        shutil.copy(dxfs[0], dst)
        return dst


ROOM_WORDS = re.compile(r"[A-Za-z]{3,}")


def pdf_room_labels(pdf_path: str, page_index: int, img_w: int) -> list[dict]:
    """Room / area names from a PDF's text layer, in rendered-image pixels.

    Keeps short text blocks that look like names (letters, not dimensions or notes)."""
    import pymupdf
    doc = pymupdf.open(pdf_path)
    if page_index >= len(doc):
        return []
    page = doc[page_index]
    z = img_w / page.rect.width
    rot = page.rotation_matrix
    out = []
    for x0, y0, x1, y1, text, *_ in page.get_text("blocks"):
        t = " ".join(text.split())
        if not (3 <= len(t) <= 40) or not ROOM_WORDS.search(t):
            continue
        letters = sum(c.isalpha() for c in t)
        if letters < len(t) * 0.6 or t.lower().startswith(("for ", "note", "refer", "drg", "detail")):
            continue
        c = pymupdf.Point((x0 + x1) / 2, (y0 + y1) / 2) * rot
        out.append({"text": t, "x": round(c.x * z, 1), "y": round(c.y * z, 1)})
    return out
