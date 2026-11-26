"""Phase 5 API: room recognition, vendor quotes & comparison, project versions."""
from __future__ import annotations

import re
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import calc
from .db import get_db
from .drawings import pdf_room_labels
from .models import (Project, Layout, Placement, Route, Annotation, CatalogueItem, VendorQuote, Snapshot,
                     QuantityOverride, PortOverride, BoqLine)

router = APIRouter(prefix="/api")


def _project(db, pid) -> Project:
    p = db.get(Project, pid)
    if not p:
        raise HTTPException(404, "Project not found")
    return p


# ---------------- room recognition ----------------
@router.get("/layouts/{lid}/room-labels")
def room_labels(lid: int, db: Session = Depends(get_db)):
    l = db.get(Layout, lid)
    if not l:
        raise HTTPException(404, "Layout not found")
    if l.file_type != "pdf":
        return {"labels": [], "note": "Room names are read from PDF drawings with a text layer. Type rooms by hand for images, DXF and scanned PDFs."}
    m = re.search(r"page-(\d+)\.png$", l.image_path)
    labels = pdf_room_labels(l.original_path, int(m.group(1)) - 1 if m else 0, l.width)
    note = "" if labels else "No text found in this PDF (it may be a scan). Type rooms by hand."
    return {"labels": labels, "note": note}


# ---------------- vendor quotes ----------------
class QuoteIn(BaseModel):
    vendor: str
    rate: float
    quote_ref: str = ""
    quote_date: str = ""


def _quotes(db, iid):
    return [{"id": q.id, "vendor": q.vendor, "rate": q.rate, "quote_ref": q.quote_ref, "quote_date": q.quote_date}
            for q in db.scalars(select(VendorQuote).where(VendorQuote.catalogue_item_id == iid).order_by(VendorQuote.rate))]


@router.get("/catalogue/items/{iid}/quotes")
def get_quotes(iid: int, db: Session = Depends(get_db)):
    return _quotes(db, iid)


@router.post("/catalogue/items/{iid}/quotes", status_code=201)
def add_quote(iid: int, body: QuoteIn, db: Session = Depends(get_db)):
    if not db.get(CatalogueItem, iid):
        raise HTTPException(404, "Item not found")
    if not body.vendor.strip() or body.rate < 0:
        raise HTTPException(422, "Vendor name and a rate ≥ 0 are required")
    db.add(VendorQuote(catalogue_item_id=iid, vendor=body.vendor.strip()[:120], rate=body.rate,
                       quote_ref=body.quote_ref[:120], quote_date=body.quote_date[:20]))
    db.commit()
    return _quotes(db, iid)


@router.delete("/quotes/{qid}")
def delete_quote(qid: int, db: Session = Depends(get_db)):
    q = db.get(VendorQuote, qid)
    if not q:
        raise HTTPException(404, "Quote not found")
    iid = q.catalogue_item_id
    db.delete(q)
    db.commit()
    return _quotes(db, iid)


@router.get("/projects/{pid}/vendor-compare")
def vendor_compare(pid: int, db: Session = Depends(get_db)):
    p = _project(db, pid)
    b = calc.compute_all(db, p)["boq"]
    ids = {l["catalogue_item_id"] for l in b["lines"] if l.get("catalogue_item_id")}
    quotes = db.scalars(select(VendorQuote).where(VendorQuote.catalogue_item_id.in_(ids))).all() if ids else []
    by_item: dict[int, dict[str, float]] = {}
    for q in quotes:
        cur = by_item.setdefault(q.catalogue_item_id, {})
        cur[q.vendor] = min(q.rate, cur.get(q.vendor, q.rate))
    vendors = sorted({q.vendor for q in quotes})
    rows, totals, covered = [], {v: 0.0 for v in vendors}, {v: 0 for v in vendors}
    best_total = current_total = 0.0
    for l in b["lines"]:
        iid = l.get("catalogue_item_id")
        rates = by_item.get(iid, {}) if iid else {}
        qty = float(l["qty"])
        cur_amt = qty * float(l["rate"])
        current_total += cur_amt
        for v in vendors:
            if v in rates:
                totals[v] += qty * rates[v]
                covered[v] += 1
            else:
                totals[v] += cur_amt  # no quote → keep current rate
        best_v = min(rates, key=rates.get) if rates else None
        best_total += qty * rates[best_v] if best_v else cur_amt
        if rates:
            rows.append({"key": l["key"], "description": l["description"], "qty": qty, "uom": l["uom"],
                         "current_rate": l["rate"], "rate_source": l["rate_source"], "catalogue_item_id": iid,
                         "rates": rates, "best_vendor": best_v, "best_rate": rates[best_v]})
    return {"vendors": vendors, "rows": rows, "lines_total": len(b["lines"]),
            "totals": {v: round(t, 2) for v, t in totals.items()}, "covered": covered,
            "current_total": round(current_total, 2), "best_total": round(best_total, 2)}


class ApplyIn(BaseModel):
    vendor: str  # vendor name or "cheapest"


@router.post("/projects/{pid}/vendor-compare/apply")
def apply_vendor(pid: int, body: ApplyIn, db: Session = Depends(get_db)):
    cmp = vendor_compare(pid, db)
    n = 0
    for r in cmp["rows"]:
        rate = r["best_rate"] if body.vendor == "cheapest" else r["rates"].get(body.vendor)
        if rate is None:
            continue
        item = db.get(CatalogueItem, r["catalogue_item_id"])
        item.vendor_rate = rate
        n += 1
    db.commit()
    return {"updated_items": n, **vendor_compare(pid, db)}


# ---------------- versions ----------------
class VersionIn(BaseModel):
    label: str = ""


def _snapshot_data(db, p: Project) -> dict:
    layouts = []
    code_of = {}
    for b in p.buildings:
        for f in b.floors:
            for l in f.layouts:
                for pl in l.placements:
                    code_of[pl.id] = pl.equip_code
    for b in p.buildings:
        for f in b.floors:
            for l in f.layouts:
                layouts.append({
                    "layout_id": l.id, "scale_m_per_px": l.scale_m_per_px,
                    "placements": [{"equip_code": pl.equip_code, "catalogue_item_id": pl.catalogue_item_id, "x": pl.x, "y": pl.y,
                                    "rotation": pl.rotation, "room": pl.room, "phase": pl.phase, "ports": pl.ports,
                                    "remarks": pl.remarks, "source": pl.source,
                                    "serving_rack": code_of.get(pl.serving_rack_id)} for pl in l.placements],
                    "routes": [{"kind": r.kind, "points": r.points, "vertical_m": r.vertical_m, "label": r.label}
                               for r in db.scalars(select(Route).where(Route.layout_id == l.id))],
                    "annotations": [{"x": a.x, "y": a.y, "text": a.text}
                                    for a in db.scalars(select(Annotation).where(Annotation.layout_id == l.id))],
                })
    return {
        "settings": p.settings or {}, "layouts": layouts,
        "quantity_overrides": [{"key": o.key, "value": o.value, "reason": o.reason}
                               for o in db.scalars(select(QuantityOverride).where(QuantityOverride.project_id == p.id))],
        "port_overrides": [{"equip_code": code_of.get(o.placement_id), "point_index": o.point_index, "data": o.data}
                           for o in db.scalars(select(PortOverride).where(PortOverride.project_id == p.id))],
        "boq_lines": [{"key": e.key, "is_manual": e.is_manual, "data": e.data}
                      for e in db.scalars(select(BoqLine).where(BoqLine.project_id == p.id))],
    }


def _summary(db, p: Project) -> dict:
    r = calc.compute_all(db, p)
    cats = {}
    for c in r["model"].ctx:
        cats[c.cat.name] = cats.get(c.cat.name, 0) + 1
    q = r["q"]
    return {"placements": len(r["model"].ctx), "points": len(r["pm"]["rows"]), "racks": len(r["pm"]["racks"]),
            "switches": q.get("switches", {}).get("value", 0), "cat6_m": q.get("cat6_m", {}).get("value", 0),
            "fiber_m": q.get("fiber_m", {}).get("value", 0), "boq_lines": len(r["boq"]["lines"]),
            "material": r["budget"]["material"], "total": r["budget"]["total"], "by_category": cats,
            "errors": sum(i["level"] == "error" for i in r["pm"]["issues"])}


def _version_dict(s: Snapshot):
    return {"id": s.id, "label": s.label, "created_at": s.created_at.isoformat(), "summary": s.summary}


@router.get("/projects/{pid}/versions")
def list_versions(pid: int, db: Session = Depends(get_db)):
    p = _project(db, pid)
    return {"current": _summary(db, p),
            "versions": [_version_dict(s) for s in db.scalars(select(Snapshot).where(Snapshot.project_id == pid)
                                                               .order_by(Snapshot.created_at.desc()))]}


@router.post("/projects/{pid}/versions", status_code=201)
def save_version(pid: int, body: VersionIn, db: Session = Depends(get_db)):
    p = _project(db, pid)
    n = db.query(Snapshot).filter(Snapshot.project_id == pid).count() + 1
    db.add(Snapshot(project_id=pid, label=body.label.strip()[:200] or f"Version {n}", summary=_summary(db, p),
                    data=_snapshot_data(db, p)))
    db.commit()
    return list_versions(pid, db)


@router.delete("/versions/{vid}")
def delete_version(vid: int, db: Session = Depends(get_db)):
    s = db.get(Snapshot, vid)
    if not s:
        raise HTTPException(404, "Version not found")
    pid = s.project_id
    db.delete(s)
    db.commit()
    return list_versions(pid, db)


@router.post("/versions/{vid}/restore")
def restore_version(vid: int, db: Session = Depends(get_db)):
    s = db.get(Snapshot, vid)
    if not s:
        raise HTTPException(404, "Version not found")
    p = _project(db, s.project_id)
    # safety net: keep what is being replaced
    db.add(Snapshot(project_id=p.id, label=f"Before restoring “{s.label}”", summary=_summary(db, p), data=_snapshot_data(db, p)))
    db.flush()
    d = s.data
    p.settings = d.get("settings", {})
    skipped = 0
    new_ids: dict[str, int] = {}
    rack_links = []
    for ld in d.get("layouts", []):
        l = db.get(Layout, ld["layout_id"])
        if not l or l.floor.building.project_id != p.id:
            skipped += 1
            continue
        l.scale_m_per_px = ld.get("scale_m_per_px")
        for pl in list(l.placements):
            l.placements.remove(pl)
        db.query(Route).filter(Route.layout_id == l.id).delete()
        db.query(Annotation).filter(Annotation.layout_id == l.id).delete()
        db.flush()
        for x in ld["placements"]:
            if not db.get(CatalogueItem, x["catalogue_item_id"]):
                continue
            pl = Placement(layout_id=l.id, equip_code=x["equip_code"], catalogue_item_id=x["catalogue_item_id"],
                           x=x["x"], y=x["y"], rotation=x["rotation"], room=x["room"], phase=x["phase"], ports=x["ports"],
                           remarks=x["remarks"], source=x["source"])
            l.placements.append(pl)
            db.flush()
            new_ids[pl.equip_code] = pl.id
            if x.get("serving_rack"):
                rack_links.append((pl, x["serving_rack"]))
        for r in ld["routes"]:
            db.add(Route(layout_id=l.id, **r))
        for a in ld["annotations"]:
            db.add(Annotation(layout_id=l.id, **a))
    for pl, code in rack_links:
        pl.serving_rack_id = new_ids.get(code)
    db.query(QuantityOverride).filter(QuantityOverride.project_id == p.id).delete()
    for o in d.get("quantity_overrides", []):
        db.add(QuantityOverride(project_id=p.id, **o))
    db.query(PortOverride).filter(PortOverride.project_id == p.id).delete()
    for o in d.get("port_overrides", []):
        pid_ = new_ids.get(o["equip_code"])
        if pid_:
            db.add(PortOverride(project_id=p.id, placement_id=pid_, point_index=o["point_index"], data=o["data"]))
    db.query(BoqLine).filter(BoqLine.project_id == p.id).delete()
    for e in d.get("boq_lines", []):
        db.add(BoqLine(project_id=p.id, **e))
    db.commit()
    db.expire_all()
    return {"restored": s.label, "skipped_layouts": skipped, **list_versions(p.id, db)}
