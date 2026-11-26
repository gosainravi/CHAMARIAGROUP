"""Phase 2-4 API: routes, quantities, port matrix, BOQ, budget, exports, AI suggestions, settings."""
from __future__ import annotations

import difflib
import io
import os
import re

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import calc, exports, ai
from .db import get_db
from .models import (Project, Layout, Route, QuantityOverride, PortOverride, BoqLine, Placement,
                     CatalogueCategory, CatalogueItem)

router = APIRouter(prefix="/api")
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _project(db, pid) -> Project:
    p = db.get(Project, pid)
    if not p:
        raise HTTPException(404, "Project not found")
    return p


def _file(data: bytes, name: str, media: str):
    safe = re.sub(r"[^A-Za-z0-9._ -]", "_", name)
    return Response(data, media_type=media, headers={"Content-Disposition": f'attachment; filename="{safe}"'})


# ---------------- settings ----------------
@router.get("/projects/{pid}/settings")
def get_settings(pid: int, db: Session = Depends(get_db)):
    p = _project(db, pid)
    return {"values": calc.settings_for(p), "defaults": calc.DEFAULTS,
            "racks": [{"id": c.pl.id, "code": c.pl.equip_code, "model": c.item.model} for c in calc.load(db, p).racks]}


@router.put("/projects/{pid}/settings")
def put_settings(pid: int, body: dict, db: Session = Depends(get_db)):
    p = _project(db, pid)
    clean = {}
    for k, v in body.items():
        if k not in calc.DEFAULTS:
            continue
        d = calc.DEFAULTS[k]
        if isinstance(d, bool):
            clean[k] = bool(v)
        elif isinstance(d, (int, float)):
            try:
                clean[k] = float(v)
            except (TypeError, ValueError):
                raise HTTPException(422, f"{k} must be a number")
            if clean[k] < 0 or (k in ("switch_ports", "pp_ports", "roll_m", "nvr_channels", "hdd_tb") and clean[k] <= 0):
                raise HTTPException(422, f"{k} must be positive")
            if k in ("switch_ports", "pp_ports", "fiber_cores", "nvr_channels"):
                clean[k] = int(clean[k])
        elif k == "vlan":
            clean[k] = {str(a): int(b) for a, b in (v or {}).items() if str(b).strip() != ""}
        else:
            clean[k] = v
    p.settings = clean
    db.commit()
    return get_settings(pid, db)


# ---------------- routes (Phase 2) ----------------
class RouteIn(BaseModel):
    kind: str
    points: list[float]
    vertical_m: float = 0
    label: str = ""


@router.get("/layouts/{lid}/routes")
def get_routes(lid: int, db: Session = Depends(get_db)):
    l = db.get(Layout, lid)
    if not l:
        raise HTTPException(404, "Layout not found")
    s = calc.settings_for(l.floor.building.project)
    return [{"id": r.id, "kind": r.kind, "points": r.points, "vertical_m": r.vertical_m, "label": r.label,
             "length_m": round(calc.route_len_m(r, l, s), 1) if l.scale_m_per_px else None}
            for r in db.scalars(select(Route).where(Route.layout_id == lid).order_by(Route.id))]


@router.put("/layouts/{lid}/routes")
def put_routes(lid: int, body: list[RouteIn], db: Session = Depends(get_db)):
    l = db.get(Layout, lid)
    if not l:
        raise HTTPException(404, "Layout not found")
    db.query(Route).filter(Route.layout_id == lid).delete()
    for r in body:
        if r.kind not in ("cat6", "cat6a", "fiber", "tray", "conduit"):
            raise HTTPException(422, f"Unknown route kind {r.kind}")
        if len(r.points) >= 4 and len(r.points) % 2 == 0:
            db.add(Route(layout_id=lid, kind=r.kind, points=r.points, vertical_m=max(0, r.vertical_m), label=r.label[:100]))
    db.commit()
    return get_routes(lid, db)


# ---------------- AI suggestions ----------------
class SuggestIn(BaseModel):
    focus: str = ""
    mode: str = "auto"  # auto | ai | grid
    spacing_m: float = 15


@router.post("/layouts/{lid}/suggest")
def suggest(lid: int, body: SuggestIn, db: Session = Depends(get_db)):
    l = db.get(Layout, lid)
    if not l:
        raise HTTPException(404, "Layout not found")
    cats = db.scalars(select(CatalogueCategory).where(CatalogueCategory.placeable.is_(True))).all()
    by_sym = {c.symbol: c for c in cats}
    use_ai = body.mode == "ai" or (body.mode == "auto" and os.getenv("ANTHROPIC_API_KEY"))
    note = ""
    if use_ai:
        if not os.getenv("ANTHROPIC_API_KEY"):
            raise HTTPException(400, "AI suggestions need ANTHROPIC_API_KEY set on the API server. Use the grid mode instead.")
        try:
            raw = ai.suggest_ai(l, ["AP", "OAP", "CAM", "BUL", "LAN", "PH", "PR", "BIO", "ACD", "RK", "TV"], body.focus)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(502, f"AI suggestion failed: {e}")
    else:
        raw = ai.suggest_grid(l, body.spacing_m)
        note = "Rule-based Wi-Fi grid (no ANTHROPIC_API_KEY set — AI reading of the drawing is off)."
    out = []
    for s in raw:
        c = by_sym.get(s["symbol"])
        item = next((i for i in c.items if i.is_active), None) if c else None
        if item:
            out.append({**s, "catalogue_item_id": item.id, "ports": c.ports_required})
    return {"suggestions": out, "note": note, "engine": "ai" if use_ai else "rule"}


# ---------------- quantities ----------------
@router.get("/projects/{pid}/quantities")
def get_quantities(pid: int, db: Session = Depends(get_db)):
    r = calc.compute_all(db, _project(db, pid))
    return {"quantities": [{k: v for k, v in q.items() if k != "weights"} for q in r["q"].values()],
            "issues": len(r["pm"]["issues"])}


class OverrideIn(BaseModel):
    value: float | None
    reason: str = ""


@router.put("/projects/{pid}/quantities/{key}")
def put_quantity(pid: int, key: str, body: OverrideIn, db: Session = Depends(get_db)):
    _project(db, pid)
    o = db.scalar(select(QuantityOverride).where(QuantityOverride.project_id == pid, QuantityOverride.key == key))
    if body.value is None:
        if o:
            db.delete(o)
    else:
        if body.value < 0:
            raise HTTPException(422, "Quantity cannot be negative")
        if not o:
            o = QuantityOverride(project_id=pid, key=key, value=body.value)
            db.add(o)
        o.value, o.reason = body.value, body.reason
    db.commit()
    return get_quantities(pid, db)


# ---------------- port matrix ----------------
@router.get("/projects/{pid}/port-matrix")
def get_port_matrix(pid: int, db: Session = Depends(get_db)):
    p = _project(db, pid)
    m = calc.load(db, p)
    pm = calc.port_matrix(db, m)
    return {**pm, "summary": calc.summary_matrix(pm)}


class PortEdit(BaseModel):
    placement_id: int
    point_index: int
    data: dict  # keys rack_id, switch_no, switch_port, pp_no, pp_port, vlan, destination, remarks; null removes


@router.put("/projects/{pid}/port-matrix")
def put_port(pid: int, body: PortEdit, db: Session = Depends(get_db)):
    _project(db, pid)
    pl = db.get(Placement, body.placement_id)
    if not pl or pl.layout.floor.building.project_id != pid:
        raise HTTPException(404, "Placement not in this project")
    o = db.scalar(select(PortOverride).where(PortOverride.project_id == pid, PortOverride.placement_id == body.placement_id,
                                             PortOverride.point_index == body.point_index))
    data = dict(o.data) if o else {}
    for k, v in body.data.items():
        if k not in ("rack_id", "switch_no", "switch_port", "pp_no", "pp_port", "vlan", "destination", "remarks"):
            continue
        if v is None or v == "":
            data.pop(k, None)
        else:
            data[k] = int(v) if k in ("rack_id", "switch_no", "switch_port", "pp_no", "pp_port") else v
    if o and not data:
        db.delete(o)
    elif data:
        if not o:
            o = PortOverride(project_id=pid, placement_id=body.placement_id, point_index=body.point_index, data=data)
            db.add(o)
        o.data = data
    db.commit()
    return get_port_matrix(pid, db)


@router.post("/projects/{pid}/port-matrix/reset")
def reset_ports(pid: int, db: Session = Depends(get_db)):
    _project(db, pid)
    db.query(PortOverride).filter(PortOverride.project_id == pid).delete()
    db.commit()
    return get_port_matrix(pid, db)


@router.get("/projects/{pid}/port-matrix.xlsx")
def port_matrix_xlsx(pid: int, db: Session = Depends(get_db)):
    p = _project(db, pid)
    pm = calc.port_matrix(db, calc.load(db, p))
    return _file(exports.port_matrix_xlsx(p, pm), f"Port Matrix - {p.name}.xlsx", XLSX)


# ---------------- BOQ & budget ----------------
@router.get("/projects/{pid}/boq")
def get_boq(pid: int, db: Session = Depends(get_db)):
    r = calc.compute_all(db, _project(db, pid))
    return {**r["boq"], "budget": r["budget"], "issues": len(r["pm"]["issues"])}


class BoqEdit(BaseModel):
    data: dict


@router.put("/projects/{pid}/boq/{key}")
def edit_boq(pid: int, key: str, body: BoqEdit, db: Session = Depends(get_db)):
    _project(db, pid)
    allowed = {"section", "kind", "description", "specs", "brand", "model", "uom", "qty", "phase1", "rate", "gst_pct",
               "install_rate", "remarks", "hidden"}
    data = {k: v for k, v in body.data.items() if k in allowed}
    for k in ("qty", "phase1", "rate", "gst_pct", "install_rate"):
        if k in data and data[k] not in (None, ""):
            try:
                data[k] = float(data[k])
            except (TypeError, ValueError):
                raise HTTPException(422, f"{k} must be a number")
            if data[k] < 0:
                raise HTTPException(422, f"{k} cannot be negative")
    if key.startswith("manual:"):
        e = db.get(BoqLine, int(key.split(":")[1]))
        if not e or e.project_id != pid:
            raise HTTPException(404, "Line not found")
        e.data = {**e.data, **data}
    else:
        e = db.scalar(select(BoqLine).where(BoqLine.project_id == pid, BoqLine.key == key, BoqLine.is_manual.is_(False)))
        merged = {**(e.data if e else {}), **data}
        merged = {k: v for k, v in merged.items() if v not in (None, "")}
        if e and not merged:
            db.delete(e)
        elif merged:
            if not e:
                e = BoqLine(project_id=pid, key=key, is_manual=False, data=merged)
                db.add(e)
            e.data = merged
    db.commit()
    return get_boq(pid, db)


@router.post("/projects/{pid}/boq")
def add_boq_line(pid: int, body: BoqEdit, db: Session = Depends(get_db)):
    _project(db, pid)
    d = {"section": "Other IT", "description": "New item", "uom": "Nos.", "qty": 1, "rate": 0, "gst_pct": 18, **body.data}
    db.add(BoqLine(project_id=pid, key="manual", is_manual=True, data=d))
    db.commit()
    return get_boq(pid, db)


@router.delete("/projects/{pid}/boq/{key}")
def delete_boq_line(pid: int, key: str, db: Session = Depends(get_db)):
    _project(db, pid)
    if key.startswith("manual:"):
        e = db.get(BoqLine, int(key.split(":")[1]))
        if e and e.project_id == pid:
            db.delete(e)
    else:  # generated line: hide it (restorable via reset)
        e = db.scalar(select(BoqLine).where(BoqLine.project_id == pid, BoqLine.key == key, BoqLine.is_manual.is_(False)))
        if not e:
            e = BoqLine(project_id=pid, key=key, is_manual=False, data={})
            db.add(e)
        e.data = {**e.data, "hidden": True}
    db.commit()
    return get_boq(pid, db)


@router.post("/projects/{pid}/boq/reset")
def reset_boq(pid: int, db: Session = Depends(get_db)):
    _project(db, pid)
    db.query(BoqLine).filter(BoqLine.project_id == pid, BoqLine.is_manual.is_(False)).delete()
    db.commit()
    return get_boq(pid, db)


@router.get("/projects/{pid}/boq.xlsx")
def boq_xlsx(pid: int, db: Session = Depends(get_db)):
    p = _project(db, pid)
    r = calc.compute_all(db, p)
    return _file(exports.boq_xlsx(p, r["boq"], r["budget"]), f"BOQ and IT Budget - {p.name}.xlsx", XLSX)


@router.post("/projects/{pid}/boq/compare")
async def compare_boq(pid: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Import an existing Excel BOQ and compare it with the calculated one."""
    from openpyxl import load_workbook
    p = _project(db, pid)
    raw = await file.read()
    try:
        wb = load_workbook(io.BytesIO(raw), data_only=True)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(422, f"Not a readable .xlsx file: {e}")
    imported = []
    for ws in wb.worksheets:
        head_row = desc_c = qty_c = uom_c = None
        for row in ws.iter_rows(min_row=1, max_row=min(ws.max_row, 15)):
            labels = {c.column: str(c.value).strip().lower() for c in row if c.value is not None}
            d = next((k for k, v in labels.items() if "description" in v or v in ("item", "items", "particulars")), None)
            qn = next((k for k, v in labels.items() if v in ("qty", "quantity", "full boq", "points") or "full boq" in v
                       or v.startswith("qty")), None)
            if d and qn:
                head_row, desc_c, qty_c = row[0].row, d, qn
                uom_c = next((k for k, v in labels.items() if v in ("uom", "unit", "meter")), None)
                break
        if not head_row:
            continue
        for row in ws.iter_rows(min_row=head_row + 1, values_only=False):
            desc = row[desc_c - 1].value if len(row) >= desc_c else None
            qty = row[qty_c - 1].value if len(row) >= qty_c else None
            if not desc or not isinstance(qty, (int, float)):
                continue
            imported.append({"sheet": ws.title, "description": str(desc).strip(), "qty": float(qty),
                             "uom": str(row[uom_c - 1].value or "") if uom_c and len(row) >= uom_c else ""})
    if not imported:
        raise HTTPException(422, "No rows with a description and a quantity column were found.")
    r = calc.compute_all(db, p)
    lines = r["boq"]["lines"]
    norm = lambda s: re.sub(r"[^a-z0-9 ]", " ", s.lower())
    used = set()
    rows = []
    for imp in imported:
        best, score = None, 0.0
        for ln in lines:
            if ln["key"] in used:
                continue
            sc = difflib.SequenceMatcher(None, norm(imp["description"]), norm(ln["description"])).ratio()
            if sc > score:
                best, score = ln, sc
        shared = best and (set(w for w in norm(imp["description"]).split() if len(w) > 2)
                           & set(w for w in norm(best["description"]).split() if len(w) > 2))
        if best and score >= 0.5 and shared:
            used.add(best["key"])
            rows.append({"status": "matched", "score": round(score, 2), "imported": imp, "calc_key": best["key"],
                         "calc_description": best["description"], "calc_qty": best["qty"], "delta": round(best["qty"] - imp["qty"], 2)})
        else:
            rows.append({"status": "only_imported", "imported": imp, "score": round(score, 2)})
    for ln in lines:
        if ln["key"] not in used:
            rows.append({"status": "only_calculated", "calc_key": ln["key"], "calc_description": ln["description"], "calc_qty": ln["qty"]})
    return {"file": file.filename, "imported_rows": len(imported), "rows": rows}


@router.get("/projects/{pid}/budget")
def get_budget(pid: int, db: Session = Depends(get_db)):
    return calc.compute_all(db, _project(db, pid))["budget"]


# ---------------- reports ----------------
@router.get("/projects/{pid}/schedule.xlsx")
def schedule_xlsx(pid: int, db: Session = Depends(get_db)):
    p = _project(db, pid)
    r = calc.compute_all(db, p)
    return _file(exports.schedule_xlsx(p, r["model"], r["q"]), f"Equipment Schedule - {p.name}.xlsx", XLSX)


def _layouts_routes(db, p):
    out = []
    for b in p.buildings:
        for f in b.floors:
            for l in f.layouts:
                out.append((l, db.scalars(select(Route).where(Route.layout_id == l.id)).all()))
    return out


@router.get("/projects/{pid}/drawings.pdf")
def drawings_pdf(pid: int, mode: str = Query("all", pattern="^(all|routing|equipment)$"), db: Session = Depends(get_db)):
    p = _project(db, pid)
    m = calc.load(db, p)
    name = {"all": "Final IT Infrastructure Layout", "routing": "Fibre and Cat6 Routing Layout", "equipment": "Equipment Placement"}[mode]
    return _file(exports.drawings_pdf(p, m, _layouts_routes(db, p), mode), f"{name} - {p.name}.pdf", "application/pdf")


@router.get("/layouts/{lid}/render.png")
def render_png(lid: int, mode: str = Query("all", pattern="^(all|routing|equipment)$"), db: Session = Depends(get_db)):
    l = db.get(Layout, lid)
    if not l:
        raise HTTPException(404, "Layout not found")
    p = l.floor.building.project
    img = exports.render_layout(l, calc.load(db, p), db.scalars(select(Route).where(Route.layout_id == lid)).all(), mode)
    b = io.BytesIO(); img.save(b, "PNG")
    return Response(b.getvalue(), media_type="image/png")


@router.get("/projects/{pid}/report")
def report(pid: int, db: Session = Depends(get_db)):
    """Everything the printable report page needs, in one call."""
    p = _project(db, pid)
    r = calc.compute_all(db, p)
    m = r["model"]
    cats, blds = {}, {}
    for c in m.ctx:
        cats[c.cat.name] = cats.get(c.cat.name, 0) + 1
        blds.setdefault(c.building.name, {}).setdefault(c.cat.name, 0)
        blds[c.building.name][c.cat.name] += 1
    return {
        "project": {k: getattr(p, k) for k in ("id", "name", "client", "location", "description", "phase", "status")},
        "schedule": [{"equip_code": c.pl.equip_code, "category": c.cat.name, "make": c.item.manufacturer, "model": c.item.model,
                      "building": c.building.name, "floor": c.floor.name, "room": c.pl.room, "phase": c.pl.phase,
                      "points": c.pl.ports} for c in m.ctx],
        "by_category": sorted(cats.items()), "by_building": blds,
        "budget": r["budget"], "issues": r["pm"]["issues"],
        "layouts": [{"id": l.id, "name": l.name, "floor": l.floor.name, "building": l.floor.building.name}
                    for l, _ in _layouts_routes(db, p)],
        "points": calc.summary_matrix(r["pm"])["totals"],
    }
