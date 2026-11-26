"""Turn an uploaded drawing (PDF/JPG/PNG/DXF/DWG) into one PNG per page/sheet for the editor."""
import os
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
    """Returns [(png_path, width, height, sheet_name)]."""
    ext = src.suffix.lower()
    if ext not in ALLOWED:
        raise DrawingError(f"Unsupported file type {ext}. Use PDF, JPG, PNG, DXF or DWG.")
    out_dir.mkdir(parents=True, exist_ok=True)
    if ext in (".jpg", ".jpeg", ".png"):
        return [_raster(src, out_dir)]
    if ext == ".pdf":
        return _pdf(src, out_dir)
    if ext == ".dwg":
        src = dwg_to_dxf(src, out_dir)
    return [_dxf(src, out_dir)]


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


def _dxf(src: Path, out_dir: Path):
    import ezdxf
    from ezdxf import recover
    from ezdxf.addons.drawing import Frontend, RenderContext, layout, pymupdf as dpm, config

    try:
        doc, _ = recover.readfile(str(src))
    except Exception as e:  # noqa: BLE001
        raise DrawingError(f"Could not read DXF: {e}") from e
    msp = doc.modelspace()
    backend = dpm.PyMuPdfBackend()
    cfg = config.Configuration(background_policy=config.BackgroundPolicy.WHITE,
                               color_policy=config.ColorPolicy.BLACK)
    Frontend(RenderContext(doc), backend, config=cfg).draw_layout(msp)
    # width/height 0 = auto-size to the drawing extents, capped at A0
    page = layout.Page(0, 0, layout.Units.mm, max_width=1189, max_height=841)
    png = backend.get_pixmap_bytes(page, fmt="png", dpi=150, settings=layout.Settings(fit_page=True))
    out = out_dir / "page-1.png"
    out.write_bytes(png)
    with Image.open(out) as im:
        w, h = im.size
    return out, w, h, "Model"


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
