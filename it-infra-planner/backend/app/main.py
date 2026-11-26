import re
import shutil
import uuid
from pathlib import Path

from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from .db import Base, engine, get_db, SessionLocal
from .models import (Project, Building, Floor, Layout, CatalogueCategory, CatalogueItem,
                     Placement, Annotation, IdCounter)
from .drawings import render, DrawingError, ALLOWED
from .seed import seed_catalogue, seed_extras
from .api2 import router as api2_router
from sqlalchemy import text

STORAGE = Path(__file__).resolve().parent.parent / "storage"
MAX_UPLOAD = 80 * 1024 * 1024
DEFAULT_LAYERS = ["Network", "Fiber", "Cabling", "Wireless", "CCTV", "Telephony", "Access", "AV", "Power",
                  "Other", "Annotations"]

app = FastAPI(title="IT Infra Planner API")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
                   allow_methods=["*"], allow_headers=["*"], expose_headers=["Content-Disposition"])
app.include_router(api2_router)

MIGRATIONS = [
    "ALTER TABLE project ADD COLUMN IF NOT EXISTS settings JSON DEFAULT '{}'",
    "ALTER TABLE catalogue_category ADD COLUMN IF NOT EXISTS placeable BOOLEAN DEFAULT TRUE",
    "ALTER TABLE catalogue_item ADD COLUMN IF NOT EXISTS code VARCHAR(60)",
    "ALTER TABLE placement ADD COLUMN IF NOT EXISTS serving_rack_id INTEGER",
]


@app.on_event("startup")
def startup():
    Base.metadata.create_all(engine)
    with engine.begin() as con:
        for sql in MIGRATIONS:
            con.execute(text(sql))
    with SessionLocal() as db:
        seed_catalogue(db)
        seed_extras(db)


# ---------------- schemas ----------------
class ProjectIn(BaseModel):
    name: str
    client: str = ""
    location: str = ""
    description: str = ""
    num_buildings: int = 1
    num_floors: int = 1
    phase: str = "Planning"
    status: str = "Draft"


class ProjectPatch(BaseModel):
    name: str | None = None
    client: str | None = None
    location: str | None = None
    description: str | None = None
    num_buildings: int | None = None
    num_floors: int | None = None
    phase: str | None = None
    status: str | None = None


class NamedIn(BaseModel):
    name: str
    code: str | None = None
    level: int | None = None


class LayoutPatch(BaseModel):
    name: str | None = None
    scale_m_per_px: float | None = None
    layers: dict | None = None


class PlacementIn(BaseModel):
    id: int | None = None
    catalogue_item_id: int
    x: float
    y: float
    rotation: float = 0
    room: str = ""
    phase: str = "Phase 1"
    ports: int | None = None
    remarks: str = ""
    source: str = "manual"
    serving_rack_id: int | None = None


class AnnotationIn(BaseModel):
    x: float
    y: float
    text: str


class ContentIn(BaseModel):
    placements: list[PlacementIn]
    annotations: list[AnnotationIn] = []


class ItemIn(BaseModel):
    category_id: int
    manufacturer: str = "Generic"
    model: str = ""
    description: str = ""
    specs: str = ""
    uom: str = "Nos."
    indicative_rate: float = 0
    vendor_rate: float | None = None
    gst_pct: float = 18
    warranty: str = ""
    datasheet_url: str = ""
    install_rate: float = 0


class ItemPatch(BaseModel):
    manufacturer: str | None = None
    model: str | None = None
    description: str | None = None
    specs: str | None = None
    uom: str | None = None
    indicative_rate: float | None = None
    vendor_rate: float | None = None
    gst_pct: float | None = None
    warranty: str | None = None
    datasheet_url: str | None = None
    install_rate: float | None = None
    is_active: bool | None = None
    category_id: int | None = None


# ---------------- helpers ----------------
def _code(s: str, fallback: str) -> str:
    c = re.sub(r"[^A-Za-z0-9]", "", s or "").upper()[:8]
    return c or fallback


FLOOR_NAMES = ["Ground Floor", "First Floor", "Second Floor", "Third Floor", "Fourth Floor", "Fifth Floor"]
FLOOR_CODES = ["GF", "FF", "SF", "TF", "4F", "5F"]


def _floor_defaults(level: int):
    if level < len(FLOOR_NAMES):
        return FLOOR_NAMES[level], FLOOR_CODES[level]
    return f"Floor {level}", f"{level}F"


def _layout_dict(l: Layout):
    return {"id": l.id, "name": l.name, "file_type": l.file_type, "original_name": l.original_name,
            "width": l.width, "height": l.height, "scale_m_per_px": l.scale_m_per_px,
            "placements": len(l.placements), "updated_at": l.updated_at.isoformat()}


def _project_dict(p: Project, deep=False):
    d = {k: getattr(p, k) for k in ("id", "name", "client", "location", "description", "num_buildings",
                                    "num_floors", "phase", "status")}
    d["created_at"] = p.created_at.isoformat()
    if deep:
        d["buildings"] = [{
            "id": b.id, "name": b.name, "code": b.code,
            "floors": [{"id": f.id, "name": f.name, "code": f.code, "level": f.level,
                        "layouts": [_layout_dict(l) for l in f.layouts]} for f in b.floors]}
            for b in p.buildings]
    else:
        d["layout_count"] = sum(len(f.layouts) for b in p.buildings for f in b.floors)
        d["placement_count"] = sum(len(l.placements) for b in p.buildings for f in b.floors for l in f.layouts)
    return d


def _get(db, model, id_):
    obj = db.get(model, id_)
    if not obj:
        raise HTTPException(404, f"{model.__name__} {id_} not found")
    return obj


def _sync_structure(db: Session, p: Project):
    """Add buildings/floors up to the counts on the project (never deletes)."""
    while len(p.buildings) < p.num_buildings:
        n = len(p.buildings) + 1
        p.buildings.append(Building(name=f"Building {n}", code=f"B{n}", sort=n))
    for b in p.buildings:
        while len(b.floors) < p.num_floors:
            lvl = len(b.floors)
            name, code = _floor_defaults(lvl)
            b.floors.append(Floor(name=name, code=code, level=lvl))


# ---------------- projects ----------------
@app.get("/api/projects")
def list_projects(db: Session = Depends(get_db)):
    return [_project_dict(p) for p in db.scalars(select(Project).order_by(Project.created_at.desc()))]


@app.post("/api/projects", status_code=201)
def create_project(body: ProjectIn, db: Session = Depends(get_db)):
    if not body.name.strip():
        raise HTTPException(422, "Project name is required")
    body.num_buildings = max(1, min(body.num_buildings, 50))
    body.num_floors = max(1, min(body.num_floors, 60))
    p = Project(**body.model_dump())
    db.add(p)
    _sync_structure(db, p)
    db.commit()
    return _project_dict(p, deep=True)


@app.get("/api/projects/{pid}")
def get_project(pid: int, db: Session = Depends(get_db)):
    return _project_dict(_get(db, Project, pid), deep=True)


@app.patch("/api/projects/{pid}")
def patch_project(pid: int, body: ProjectPatch, db: Session = Depends(get_db)):
    p = _get(db, Project, pid)
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(p, k, v)
    _sync_structure(db, p)
    db.commit()
    return _project_dict(p, deep=True)


@app.delete("/api/projects/{pid}", status_code=204)
def delete_project(pid: int, db: Session = Depends(get_db)):
    p = _get(db, Project, pid)
    db.delete(p)
    db.commit()
    shutil.rmtree(STORAGE / f"p{pid}", ignore_errors=True)


# ---------------- buildings / floors ----------------
@app.post("/api/projects/{pid}/buildings", status_code=201)
def add_building(pid: int, body: NamedIn, db: Session = Depends(get_db)):
    p = _get(db, Project, pid)
    n = len(p.buildings) + 1
    code = _code(body.code or "", f"B{n}")
    if any(b.code == code for b in p.buildings):
        raise HTTPException(409, f"Building code {code} already used")
    b = Building(name=body.name, code=code, sort=n)
    p.buildings.append(b)
    p.num_buildings = len(p.buildings)
    name, fcode = _floor_defaults(0)
    b.floors.append(Floor(name=name, code=fcode, level=0))
    db.commit()
    return _project_dict(p, deep=True)


@app.patch("/api/buildings/{bid}")
def patch_building(bid: int, body: NamedIn, db: Session = Depends(get_db)):
    b = _get(db, Building, bid)
    b.name = body.name
    if body.code:
        code = _code(body.code, b.code)
        if any(o.code == code and o.id != b.id for o in b.project.buildings):
            raise HTTPException(409, f"Building code {code} already used")
        b.code = code
    db.commit()
    return _project_dict(b.project, deep=True)


@app.delete("/api/buildings/{bid}")
def delete_building(bid: int, db: Session = Depends(get_db)):
    b = _get(db, Building, bid)
    p = b.project
    if len(p.buildings) == 1:
        raise HTTPException(409, "A project needs at least one building")
    p.buildings.remove(b)
    p.num_buildings = len(p.buildings)
    db.commit()
    return _project_dict(p, deep=True)


@app.post("/api/buildings/{bid}/floors", status_code=201)
def add_floor(bid: int, body: NamedIn, db: Session = Depends(get_db)):
    b = _get(db, Building, bid)
    lvl = body.level if body.level is not None else (max((f.level for f in b.floors), default=-1) + 1)
    dname, dcode = _floor_defaults(lvl)
    code = _code(body.code or "", dcode)
    if any(f.code == code for f in b.floors):
        raise HTTPException(409, f"Floor code {code} already used in {b.name}")
    b.floors.append(Floor(name=body.name or dname, code=code, level=lvl))
    db.commit()
    return _project_dict(b.project, deep=True)


@app.patch("/api/floors/{fid}")
def patch_floor(fid: int, body: NamedIn, db: Session = Depends(get_db)):
    f = _get(db, Floor, fid)
    f.name = body.name
    if body.code:
        code = _code(body.code, f.code)
        if any(o.code == code and o.id != f.id for o in f.building.floors):
            raise HTTPException(409, f"Floor code {code} already used")
        f.code = code
    if body.level is not None:
        f.level = body.level
    db.commit()
    return _project_dict(f.building.project, deep=True)


@app.delete("/api/floors/{fid}")
def delete_floor(fid: int, db: Session = Depends(get_db)):
    f = _get(db, Floor, fid)
    b = f.building
    if len(b.floors) == 1:
        raise HTTPException(409, "A building needs at least one floor")
    b.floors.remove(f)
    db.commit()
    return _project_dict(b.project, deep=True)


# ---------------- layouts ----------------
@app.post("/api/floors/{fid}/layouts", status_code=201)
async def upload_layout(fid: int, file: UploadFile = File(...), name: str = Form(""),
                        db: Session = Depends(get_db)):
    f = _get(db, Floor, fid)
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED:
        raise HTTPException(415, f"Unsupported file type '{ext}'. Use PDF, JPG, PNG, DXF or DWG.")
    pid = f.building.project_id
    folder = STORAGE / f"p{pid}" / uuid.uuid4().hex
    folder.mkdir(parents=True)
    src = folder / f"original{ext}"
    size = 0
    with src.open("wb") as out:
        while chunk := await file.read(1 << 20):
            size += len(chunk)
            if size > MAX_UPLOAD:
                out.close()
                shutil.rmtree(folder, ignore_errors=True)
                raise HTTPException(413, "File larger than 80 MB")
            out.write(chunk)
    try:
        pages = render(src, folder)
    except DrawingError as e:
        shutil.rmtree(folder, ignore_errors=True)
        raise HTTPException(422, str(e))
    base = name.strip() or Path(file.filename).stem
    created = []
    for png, w, h, sheet in pages:
        l = Layout(name=base if len(pages) == 1 else f"{base} – {sheet}", file_type=ext.lstrip("."),
                   original_name=file.filename, original_path=str(src), image_path=str(png), width=w, height=h,
                   layers={k: {"visible": True, "locked": False} for k in DEFAULT_LAYERS})
        f.layouts.append(l)
        created.append(l)
    db.commit()
    return {"created": [_layout_dict(l) for l in created], "project": _project_dict(f.building.project, deep=True)}


def _layout_full(l: Layout):
    f = l.floor
    b = f.building
    return {**_layout_dict(l), "layers": l.layers,
            "floor": {"id": f.id, "name": f.name, "code": f.code},
            "building": {"id": b.id, "name": b.name, "code": b.code},
            "project": {"id": b.project.id, "name": b.project.name},
            "placements": [{
                "id": p.id, "equip_code": p.equip_code, "catalogue_item_id": p.catalogue_item_id,
                "x": p.x, "y": p.y, "rotation": p.rotation, "room": p.room, "phase": p.phase,
                "ports": p.ports, "remarks": p.remarks, "source": p.source,
                "serving_rack_id": p.serving_rack_id} for p in l.placements],
            "annotations": [{"x": a.x, "y": a.y, "text": a.text}
                            for a in sorted(_annotations(l), key=lambda a: a.id)]}


def _annotations(l: Layout):
    from sqlalchemy.orm import object_session
    return object_session(l).scalars(select(Annotation).where(Annotation.layout_id == l.id)).all()


@app.get("/api/layouts/{lid}")
def get_layout(lid: int, db: Session = Depends(get_db)):
    return _layout_full(_get(db, Layout, lid))


@app.get("/api/layouts/{lid}/image")
def layout_image(lid: int, db: Session = Depends(get_db)):
    l = _get(db, Layout, lid)
    return FileResponse(l.image_path, media_type="image/png",
                        headers={"Cache-Control": "private, max-age=86400"})


@app.get("/api/layouts/{lid}/original")
def layout_original(lid: int, db: Session = Depends(get_db)):
    l = _get(db, Layout, lid)
    return FileResponse(l.original_path, filename=l.original_name)


@app.patch("/api/layouts/{lid}")
def patch_layout(lid: int, body: LayoutPatch, db: Session = Depends(get_db)):
    l = _get(db, Layout, lid)
    data = body.model_dump(exclude_unset=True)
    if "scale_m_per_px" in data and data["scale_m_per_px"] is not None and data["scale_m_per_px"] <= 0:
        raise HTTPException(422, "Scale must be positive")
    for k, v in data.items():
        setattr(l, k, v)
    db.commit()
    return _layout_full(l)


@app.delete("/api/layouts/{lid}", status_code=204)
def delete_layout(lid: int, db: Session = Depends(get_db)):
    l = _get(db, Layout, lid)
    folder = Path(l.image_path).parent
    siblings = db.scalar(select(func.count()).select_from(Layout).where(
        Layout.original_path == l.original_path, Layout.id != l.id))
    db.delete(l)
    db.commit()
    if not siblings:
        shutil.rmtree(folder, ignore_errors=True)


@app.put("/api/layouts/{lid}/content")
def save_content(lid: int, body: ContentIn, db: Session = Depends(get_db)):
    l = _get(db, Layout, lid)
    f, b = l.floor, l.floor.building
    existing = {p.id: p for p in l.placements}
    items = {i.id: i for i in db.scalars(select(CatalogueItem).where(
        CatalogueItem.id.in_({p.catalogue_item_id for p in body.placements})))}
    keep = set()
    for pin in body.placements:
        item = items.get(pin.catalogue_item_id)
        if not item:
            raise HTTPException(422, f"Catalogue item {pin.catalogue_item_id} not found")
        ports = pin.ports if pin.ports is not None else item.category.ports_required
        fields = dict(catalogue_item_id=item.id, x=pin.x, y=pin.y, rotation=pin.rotation % 360,
                      room=pin.room, phase=pin.phase, ports=max(0, ports), remarks=pin.remarks, source=pin.source,
                      serving_rack_id=pin.serving_rack_id)
        if pin.id and pin.id in existing:
            p = existing[pin.id]
            old_sym = p.item.category.symbol
            for k, v in fields.items():
                setattr(p, k, v)
            if item.category.symbol != old_sym:  # type changed → new ID with the right symbol
                p.equip_code = _next_code(db, b, f, item.category.symbol)
            keep.add(p.id)
        else:
            p = Placement(layout_id=l.id, equip_code=_next_code(db, b, f, item.category.symbol), **fields)
            db.add(p)
            l.placements.append(p)
    for pid_, p in existing.items():
        if pid_ not in keep:
            l.placements.remove(p)
    db.query(Annotation).filter(Annotation.layout_id == l.id).delete()
    for a in body.annotations:
        if a.text.strip():
            db.add(Annotation(layout_id=l.id, x=a.x, y=a.y, text=a.text))
    from .models import now
    l.updated_at = now()
    db.commit()
    db.refresh(l)
    return _layout_full(l)


def _next_code(db: Session, b: Building, f: Floor, symbol: str) -> str:
    prefix = f"{b.code}-{f.code}-{symbol}"
    c = db.scalar(select(IdCounter).where(IdCounter.project_id == b.project_id, IdCounter.prefix == prefix)
                  .with_for_update())
    if not c:
        c = IdCounter(project_id=b.project_id, prefix=prefix, last=0)
        db.add(c)
    c.last += 1
    db.flush()
    return f"{prefix}-{c.last:03d}"


# ---------------- catalogue ----------------
def _item_dict(i: CatalogueItem):
    return {k: getattr(i, k) for k in ("id", "category_id", "manufacturer", "model", "description", "specs", "uom",
                                       "indicative_rate", "vendor_rate", "gst_pct", "warranty", "datasheet_url",
                                       "install_rate", "is_active", "code")}


@app.get("/api/catalogue")
def catalogue(db: Session = Depends(get_db)):
    cats = db.scalars(select(CatalogueCategory).order_by(CatalogueCategory.sort)).all()
    return [{"id": c.id, "group": c.group, "name": c.name, "layer": c.layer, "symbol": c.symbol, "color": c.color,
             "point_type": c.point_type, "ports_required": c.ports_required, "placeable": c.placeable,
             "items": [_item_dict(i) for i in c.items]} for c in cats]


@app.post("/api/catalogue/items", status_code=201)
def add_item(body: ItemIn, db: Session = Depends(get_db)):
    _get(db, CatalogueCategory, body.category_id)
    i = CatalogueItem(**body.model_dump())
    db.add(i)
    db.commit()
    return _item_dict(i)


@app.patch("/api/catalogue/items/{iid}")
def patch_item(iid: int, body: ItemPatch, db: Session = Depends(get_db)):
    i = _get(db, CatalogueItem, iid)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(i, k, v)
    db.commit()
    return _item_dict(i)


@app.delete("/api/catalogue/items/{iid}")
def delete_item(iid: int, db: Session = Depends(get_db)):
    i = _get(db, CatalogueItem, iid)
    used = db.scalar(select(func.count()).select_from(Placement).where(Placement.catalogue_item_id == iid))
    if used:
        i.is_active = False  # keep history; hide from library
        db.commit()
        return {"deleted": False, "deactivated": True, "used_by": used}
    db.delete(i)
    db.commit()
    return {"deleted": True}


@app.get("/api/health")
def health():
    return {"ok": True}
