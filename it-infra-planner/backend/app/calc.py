"""Deterministic calculation engine: placements → quantities → port matrix → BOQ → budget.

Everything here is a pure function of the database state, so screens and Excel exports always agree.
"""
from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import (Project, Placement, CatalogueItem, CatalogueCategory, Route, QuantityOverride,
                     PortOverride, BoqLine, Layout, Floor, Building)

DEFAULTS = {
    "spare_pct": 20,            # spare switch ports
    "wastage_pct": 10,          # cable wastage
    "contingency_pct": 10,
    "switch_ports": 24,         # usable copper ports per access switch
    "pp_ports": 24,
    "roll_m": 305,
    "service_loop_m": 3,
    "vertical_drop_m": 3,
    "floor_height_m": 4,
    "default_run_m": 30,        # Cat6 run used when the layout has no scale
    "default_fiber_m": 100,     # fibre link length when racks are on different layouts / no scale
    "max_run_m": 90,
    "fiber_cores": 6,
    "wifi_cat6a": True,         # PORT MATIRX uses Cat6A for Wi-Fi
    "recording_days": 15,
    "camera_mbps": 2,
    "hdd_tb": 8,
    "nvr_channels": 32,
    "switch_poe_w": 370,
    "core_rack_id": None,
    "vlan": {"Data": 10, "Printer": 10, "Voice": 20, "CCTV": 30, "Wi-Fi": 40, "Access": 50, "AV": 60},
}
POE_W = {"Wi-Fi": 25, "CCTV": 8, "Voice": 6, "Access": 10}
POINT_SYMBOLS = {"LAN", "DP", "NO"}          # become I/O + faceplate + cable lines, not item lines
CALC_SYMBOLS = {"SW", "PP", "LIU", "SFP"}    # quantities come from the port matrix, not from symbols
RACK = "RK"


def settings_for(p: Project) -> dict:
    s = {**DEFAULTS, **(p.settings or {})}
    s["vlan"] = {**DEFAULTS["vlan"], **((p.settings or {}).get("vlan") or {})}
    return s


@dataclass
class Ctx:
    pl: Placement
    item: CatalogueItem
    cat: CatalogueCategory
    layout: Layout
    floor: Floor
    building: Building

    @property
    def fkey(self):
        return f"{self.building.code}|{self.floor.code}"


@dataclass
class Model:
    project: Project
    s: dict
    ctx: list[Ctx]
    racks: list[Ctx]
    routes: list[tuple[Route, Layout]]
    floors: dict = field(default_factory=dict)  # fkey -> (building name, floor name)


def load(db: Session, p: Project) -> Model:
    rows = db.execute(
        select(Placement, CatalogueItem, CatalogueCategory, Layout, Floor, Building)
        .join(CatalogueItem, Placement.catalogue_item_id == CatalogueItem.id)
        .join(CatalogueCategory, CatalogueItem.category_id == CatalogueCategory.id)
        .join(Layout, Placement.layout_id == Layout.id)
        .join(Floor, Layout.floor_id == Floor.id)
        .join(Building, Floor.building_id == Building.id)
        .where(Building.project_id == p.id)
        .order_by(Building.sort, Floor.level, Placement.equip_code)
    ).all()
    ctx = [Ctx(*r) for r in rows]
    routes = db.execute(select(Route, Layout).join(Layout, Route.layout_id == Layout.id)
                        .join(Floor, Layout.floor_id == Floor.id).join(Building, Floor.building_id == Building.id)
                        .where(Building.project_id == p.id)).all()
    floors = {}
    for b in p.buildings:
        for f in b.floors:
            floors[f"{b.code}|{f.code}"] = (b.name, f.name)
    return Model(p, settings_for(p), ctx, [c for c in ctx if c.cat.symbol == RACK], [tuple(r) for r in routes], floors)


# ---------------- geometry ----------------
def route_len_m(r: Route, l: Layout, s: dict) -> float:
    pts = r.points or []
    px = sum(math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]) for i in range(0, len(pts) - 2, 2))
    if not l.scale_m_per_px:
        return r.vertical_m or 0
    return px * l.scale_m_per_px + (r.vertical_m or 0)


def dist_m(a: Ctx, b: Ctx, s: dict) -> float | None:
    """Manhattan run (cables follow walls) between two placements, or None if unknown."""
    if a.layout.id == b.layout.id and a.layout.scale_m_per_px:
        return (abs(a.pl.x - b.pl.x) + abs(a.pl.y - b.pl.y)) * a.layout.scale_m_per_px
    if a.building.id == b.building.id and a.floor.id != b.floor.id:
        return None
    return None


def run_m(pt: Ctx, rack: Ctx | None, s: dict) -> float:
    if rack is None:
        return s["default_run_m"]
    d = dist_m(pt, rack, s)
    if d is None:
        d = s["default_run_m"]
        if pt.building.id == rack.building.id:
            d += abs(pt.floor.level - rack.floor.level) * s["floor_height_m"]
    return d + s["vertical_drop_m"] + s["service_loop_m"]


# ---------------- port matrix ----------------
def core_rack(m: Model) -> Ctx | None:
    if not m.racks:
        return None
    cid = m.s.get("core_rack_id")
    for r in m.racks:
        if r.pl.id == cid:
            return r
    big = [r for r in m.racks if "42" in r.item.model]
    return big[0] if big else m.racks[0]


def serving_rack(pt: Ctx, m: Model, forced: int | None) -> Ctx | None:
    want = forced or pt.pl.serving_rack_id
    if want:
        for r in m.racks:
            if r.pl.id == want:
                return r
    same_layout = [r for r in m.racks if r.layout.id == pt.layout.id]
    if same_layout:
        return min(same_layout, key=lambda r: abs(r.pl.x - pt.pl.x) + abs(r.pl.y - pt.pl.y))
    same_floor = [r for r in m.racks if r.floor.id == pt.floor.id]
    if same_floor:
        return same_floor[0]
    same_bld = [r for r in m.racks if r.building.id == pt.building.id]
    if same_bld:
        return min(same_bld, key=lambda r: abs(r.floor.level - pt.floor.level))
    return core_rack(m)


def endpoints(m: Model) -> list[Ctx]:
    return [c for c in m.ctx if c.cat.point_type and c.pl.ports > 0 and c.cat.symbol != RACK]


def port_matrix(db: Session, m: Model) -> dict:
    s = m.s
    ovr = {(o.placement_id, o.point_index): o.data for o in
           db.scalars(select(PortOverride).where(PortOverride.project_id == m.project.id))}
    points = []
    for c in endpoints(m):
        for i in range(c.pl.ports):
            o = ovr.get((c.pl.id, i), {})
            rack = serving_rack(c, m, o.get("rack_id"))
            points.append({"c": c, "i": i, "o": o, "rack": rack})

    by_rack: dict[int | None, list] = defaultdict(list)
    for p in points:
        by_rack[p["rack"].pl.id if p["rack"] else None].append(p)

    racks_out = []
    rows = []
    for rack in m.racks + [None]:
        rid = rack.pl.id if rack else None
        pts = sorted(by_rack.get(rid, []), key=lambda p: (p["c"].building.sort, p["c"].floor.level, p["c"].pl.room.lower(),
                                                         p["c"].pl.equip_code, p["i"]))
        n = len(pts)
        sw_n = math.ceil(n * (1 + s["spare_pct"] / 100) / s["switch_ports"]) if n else 0
        pp_n = max(sw_n, math.ceil(n / s["pp_ports"])) if n else 0
        rcode = rack.pl.equip_code if rack else "UNASSIGNED"
        if rack:
            racks_out.append({"id": rid, "code": rcode, "model": rack.item.model, "building": rack.building.name,
                              "floor": rack.floor.name, "fkey": rack.fkey, "points": n, "switches": sw_n,
                              "patch_panels": pp_n, "phase": rack.pl.phase})
        for idx, p in enumerate(pts):
            c, o = p["c"], p["o"]
            auto_sw, auto_port = (idx // s["switch_ports"] + 1, idx % s["switch_ports"] + 1) if rack else (None, None)
            auto_pp, auto_ppp = (idx // s["pp_ports"] + 1, idx % s["pp_ports"] + 1) if rack else (None, None)
            dest = f"{c.cat.name}{' – ' + c.pl.room if c.pl.room else ''}"
            r = {
                "placement_id": c.pl.id, "point_index": p["i"], "building": c.building.name, "bcode": c.building.code,
                "floor": c.floor.name, "fcode": c.floor.code, "fkey": c.fkey, "room": c.pl.room,
                "equip_code": c.pl.equip_code, "description": f"{c.cat.name} ({c.item.manufacturer} {c.item.model})",
                "point_type": c.cat.point_type, "cable": "Cat6A" if (c.cat.point_type == "Wi-Fi" and s["wifi_cat6a"]) else "Cat6",
                "rack_id": rid, "rack": rcode if rack else "",
                "switch_no": o.get("switch_no", auto_sw), "switch_port": o.get("switch_port", auto_port),
                "pp_no": o.get("pp_no", auto_pp), "pp_port": o.get("pp_port", auto_ppp),
                "vlan": o.get("vlan", s["vlan"].get(c.cat.point_type, "")),
                "destination": o.get("destination", dest), "remarks": o.get("remarks", c.pl.remarks),
                "length_m": round(run_m(c, rack, s), 1), "phase": c.pl.phase,
                "overridden": sorted(k for k in o if k != "rack_id") + (["rack"] if "rack_id" in o else []),
                "_sw_cap": sw_n, "_pp_cap": pp_n,
            }
            r["switch"] = f"{rcode}-SW{r['switch_no']:02d}" if rack and r["switch_no"] else ""
            r["patch_panel"] = f"{rcode}-PP{r['pp_no']:02d}" if rack and r["pp_no"] else ""
            r["cable_id"] = f"{rcode}-PP{r['pp_no']:02d}-{r['pp_port']:02d}" if rack and r["pp_no"] and r["pp_port"] else ""
            rows.append(r)

    issues = validate(rows, m)
    for i, r in enumerate(rows, 1):
        r["sn"] = i
        r.pop("_sw_cap"), r.pop("_pp_cap")
    core = core_rack(m)
    return {"rows": rows, "racks": racks_out, "issues": issues, "core_rack": core.pl.equip_code if core else None,
            "settings": {k: s[k] for k in ("switch_ports", "pp_ports", "spare_pct")}}


def validate(rows: list[dict], m: Model) -> list[dict]:
    s = m.s
    issues = []
    add = lambda lvl, code, msg, r=None: issues.append(
        {"level": lvl, "code": code, "message": msg, "placement_id": r["placement_id"] if r else None,
         "point_index": r["point_index"] if r else None})
    if not m.racks and rows:
        add("error", "no_rack", "No network rack placed in the project — place at least one Network Rack.")
    seen_sw, seen_pp = {}, {}
    poe = defaultdict(float)
    for r in rows:
        tag = f"{r['equip_code']} point {r['point_index'] + 1}"
        if not r["equip_code"]:
            add("error", "missing_id", f"Point without equipment ID ({r['description']}) — save the layout.", r)
        if not r["rack"]:
            add("error", "unassigned", f"{tag} is not assigned to any rack.", r)
            continue
        if r["switch_no"] is None or r["switch_port"] is None:
            add("error", "unassigned", f"{tag} has no switch port.", r)
        else:
            if r["switch_no"] > r["_sw_cap"] or r["switch_port"] > s["switch_ports"] or r["switch_port"] < 1:
                add("error", "switch_capacity", f"{tag}: {r['switch']} port {r['switch_port']} exceeds switch capacity "
                    f"({r['_sw_cap']} × {s['switch_ports']} ports in {r['rack']}).", r)
            k = (r["rack_id"], r["switch_no"], r["switch_port"])
            if k in seen_sw:
                add("error", "duplicate_switch_port", f"{r['switch']} port {r['switch_port']} used by {seen_sw[k]} and {tag}.", r)
            seen_sw[k] = tag
            poe[(r["rack"], r["switch_no"])] += POE_W.get(r["point_type"], 0)
        if r["pp_no"] is None or r["pp_port"] is None:
            add("error", "unassigned", f"{tag} has no patch panel port.", r)
        else:
            if r["pp_no"] > r["_pp_cap"] or r["pp_port"] > s["pp_ports"] or r["pp_port"] < 1:
                add("error", "pp_capacity", f"{tag}: {r['patch_panel']} port {r['pp_port']} exceeds patch panel capacity.", r)
            k = (r["rack_id"], r["pp_no"], r["pp_port"])
            if k in seen_pp:
                add("error", "duplicate_pp_port", f"{r['patch_panel']} port {r['pp_port']} used by {seen_pp[k]} and {tag}.", r)
            seen_pp[k] = tag
        if not str(r["destination"]).strip():
            add("warning", "missing_destination", f"{tag} has no destination.", r)
        if not r["room"]:
            add("warning", "missing_room", f"{tag} has no room / location.", r)
        if r["length_m"] > s["max_run_m"]:
            add("warning", "long_run", f"{tag}: Cat6 run ≈ {r['length_m']} m exceeds {s['max_run_m']} m — add a rack nearer.", r)
    for (rack, sw), w in poe.items():
        if w > s["switch_poe_w"]:
            add("warning", "poe_budget", f"{rack}-SW{sw:02d} PoE load ≈ {w:.0f} W exceeds {s['switch_poe_w']} W budget.")
    return issues


def summary_matrix(pm: dict) -> dict:
    """Location × point-type counts — the layout of the existing PORT MATIRX.xlsx."""
    types = ["Data", "Printer", "Voice", "CCTV", "Wi-Fi", "Access", "AV"]
    rows: dict[tuple, dict] = {}
    for r in pm["rows"]:
        k = (r["building"], r["floor"], r["room"] or "(no room)")
        row = rows.setdefault(k, {"building": k[0], "floor": k[1], "location": k[2], **{t: 0 for t in types}, "racks": set()})
        row[r["point_type"]] = row.get(r["point_type"], 0) + 1
        if r["rack"]:
            row["racks"].add(r["rack"])
    out = []
    for row in rows.values():
        row["racks"] = ", ".join(sorted(row["racks"]))
        row["total"] = sum(row[t] for t in types)
        out.append(row)
    totals = {t: sum(r[t] for r in out) for t in types}
    totals["total"] = sum(totals.values())
    return {"types": types, "rows": out, "totals": totals}


# ---------------- quantities ----------------
def quantities(db: Session, m: Model, pm: dict | None = None) -> dict:
    s = m.s
    pm = pm or port_matrix(db, m)
    rows = pm["rows"]
    q: dict[str, dict] = {}

    def put(key, label, unit, value, group, basis, weights=None):
        q[key] = {"key": key, "label": label, "unit": unit, "calc": round(value, 2), "group": group, "basis": basis,
                  "weights": weights or {}}

    by_type = defaultdict(int)
    w_points = defaultdict(float)
    for r in rows:
        by_type[r["point_type"]] += 1
        w_points[r["fkey"]] += 1
    n = len(rows)
    put("points_total", "Total network points", "Nos.", n, "Points", "Σ network points of placed equipment", w_points)
    for t, label in [("Data", "LAN / data points"), ("Printer", "Printer points"), ("Voice", "Voice points"),
                     ("CCTV", "CCTV points"), ("Wi-Fi", "Wi-Fi points"), ("Access", "Access-control points"), ("AV", "AV / TV points")]:
        put(f"points_{t.lower().replace('-', '')}", label, "Nos.", by_type.get(t, 0), "Points", f"points of type {t}")

    # placed equipment by category
    by_cat = defaultdict(lambda: {"n": 0, "w": defaultdict(float)})
    for c in m.ctx:
        by_cat[c.cat.id]["n"] += 1
        by_cat[c.cat.id]["w"][c.fkey] += 1
        by_cat[c.cat.id]["cat"] = c.cat
    for v in by_cat.values():
        c = v["cat"]
        put(f"placed_{c.symbol}", f"{c.name} (placed)", "Nos.", v["n"], "Placed equipment", "count of symbols on layouts", v["w"])

    # rack hardware
    w_sw, w_pp, w_rack = defaultdict(float), defaultdict(float), defaultdict(float)
    for r in pm["racks"]:
        w_sw[r["fkey"]] += r["switches"]
        w_pp[r["fkey"]] += r["patch_panels"]
        w_rack[r["fkey"]] += 1
    sw = sum(r["switches"] for r in pm["racks"])
    pp = sum(r["patch_panels"] for r in pm["racks"])
    put("racks", "Network racks", "Nos.", len(pm["racks"]), "Rack & switching", "racks placed", w_rack)
    put("switches", "Access switches (24 port PoE)", "Nos.", sw, "Rack & switching",
        f"per rack ⌈points × (1 + {s['spare_pct']}%) / {s['switch_ports']}⌉", w_sw)
    put("patch_panels", "Patch panels (24 port)", "Nos.", pp, "Rack & switching", "per rack, one per switch", w_pp)
    put("pdu", "PDU", "Nos.", len(pm["racks"]), "Rack & switching", "1 per rack", w_rack)
    put("cable_manager", "Cable managers", "Nos.", pp, "Rack & switching", "1 per patch panel", w_pp)

    # fibre backbone
    core = core_rack(m)
    field_racks = [r for r in m.racks if core and r.pl.id != core.pl.id]
    fib_routes = [(r, l) for r, l in m.routes if r.kind == "fiber"]
    if fib_routes:
        fiber_m = sum(route_len_m(r, l, s) for r, l in fib_routes) * (1 + s["wastage_pct"] / 100)
        fbasis = f"Σ drawn fibre routes + {s['wastage_pct']}% wastage"
    else:
        fiber_m = 0
        for r in field_racks:
            d = dist_m(r, core, s)
            fiber_m += (d * 1.1 + 10) if d is not None else s["default_fiber_m"]
        fbasis = f"rack → core distance × 1.1 + 10 m (or {s['default_fiber_m']} m when not on same scaled layout)"
    links = len(field_racks)
    w_links = defaultdict(float)
    for r in field_racks:
        w_links[r.fkey] += 1
    put("fiber_links", "Fibre links (field rack → core)", "Nos.", links, "Fibre", "one per field rack", w_links)
    put("fiber_m", "Fibre cable 6 core SM", "Mtrs.", math.ceil(fiber_m), "Fibre", fbasis, w_links)
    put("sfp", "SFP modules", "Nos.", links * 2, "Fibre", "2 per fibre link", w_links)
    put("fiber_patch", "Fibre patch cords", "Nos.", links * 2, "Fibre", "1 per SFP", w_links)
    put("liu_field", "LIU 12 port (field racks)", "Nos.", links, "Fibre", "1 per field rack", w_links)
    put("liu_core", "LIU 24 port (core)", "Nos.", math.ceil(links * s["fiber_cores"] / 24) if links else 0, "Fibre",
        f"⌈links × {s['fiber_cores']} cores / 24⌉")
    put("splicing", "Fibre splicing", "Core", links * s["fiber_cores"] * 2, "Fibre", f"links × {s['fiber_cores']} cores × 2 ends", w_links)

    # copper
    w6, w6a = defaultdict(float), defaultdict(float)
    m6 = m6a = 0.0
    for r in rows:
        if r["cable"] == "Cat6A":
            m6a += r["length_m"]; w6a[r["fkey"]] += r["length_m"]
        else:
            m6 += r["length_m"]; w6[r["fkey"]] += r["length_m"]
    extra6 = sum(route_len_m(r, l, s) for r, l in m.routes if r.kind == "cat6")
    extra6a = sum(route_len_m(r, l, s) for r, l in m.routes if r.kind == "cat6a")
    k = 1 + s["wastage_pct"] / 100
    cat6_m, cat6a_m = (m6 + extra6) * k, (m6a + extra6a) * k
    put("cat6_m", "Cat6 cable", "Mtrs.", math.ceil(cat6_m), "Copper",
        f"Σ point runs (Manhattan to rack + {s['vertical_drop_m']} m drop + {s['service_loop_m']} m loop) + drawn Cat6 routes, +{s['wastage_pct']}%", w6)
    put("cat6_rolls", "Cat6 cable rolls (305 m)", "Roll", math.ceil(cat6_m / s["roll_m"]) if cat6_m else 0, "Copper", "⌈metres / 305⌉", w6)
    put("cat6a_m", "Cat6A cable", "Mtrs.", math.ceil(cat6a_m), "Copper", "Wi-Fi point runs on Cat6A", w6a)
    put("cat6a_rolls", "Cat6A cable rolls (305 m)", "Roll", math.ceil(cat6a_m / s["roll_m"]) if cat6a_m else 0, "Copper", "⌈metres / 305⌉", w6a)
    put("rj45_io", "RJ45 Cat6 I/O", "Nos.", n * 2, "Copper", "2 per point (user end + panel end)", w_points)
    dual = quad = 0
    w_fp = defaultdict(float)
    for c in endpoints(m):
        if c.cat.point_type in ("Data", "Voice", "Printer", "AV"):
            if c.pl.ports <= 2:
                dual += 1
            else:
                quad += math.ceil(c.pl.ports / 4)
            w_fp[c.fkey] += 1
    put("faceplate_dual", "Face plates dual", "Nos.", dual, "Copper", "user outlets with ≤ 2 ports", w_fp)
    put("faceplate_quad", "Face plates quad", "Nos.", quad, "Copper", "⌈ports / 4⌉ for outlets with > 2 ports", w_fp)
    put("gang_box", "Gang boxes", "Nos.", n, "Copper", "1 per point (as in pujaso BOQ)", w_points)
    put("patch_cord_1m", "Patch cords 1 m (panel end)", "Nos.", n, "Copper", "1 per point", w_points)
    put("patch_cord_2m", "Patch cords 2 m (user end)", "Nos.", n, "Copper", "1 per point", w_points)

    # CCTV
    cams = [c for c in m.ctx if c.cat.point_type == "CCTV" and c.cat.symbol != "NVR"]
    w_cam = defaultdict(float)
    for c in cams:
        w_cam[c.fkey] += 1
    outdoor = sum(1 for c in cams if c.cat.symbol in ("BUL", "PTZ", "ANPR"))
    put("cameras", "CCTV cameras", "Nos.", len(cams), "CCTV", "cameras placed", w_cam)
    placed_nvr = sum(1 for c in m.ctx if c.cat.symbol == "NVR")
    put("nvr", "NVR", "Nos.", placed_nvr or (math.ceil(len(cams) / s["nvr_channels"]) if cams else 0), "CCTV",
        "NVRs placed" if placed_nvr else f"⌈cameras / {s['nvr_channels']}⌉ (no NVR placed)")
    tb = len(cams) * s["camera_mbps"] / 8 * 86400 * s["recording_days"] / 1e6
    put("hdd", f"Surveillance HDD {s['hdd_tb']} TB", "Nos.", math.ceil(tb / s["hdd_tb"]) if cams else 0, "CCTV",
        f"cameras × {s['camera_mbps']} Mbps × {s['recording_days']} days ≈ {tb:.1f} TB")
    put("camera_box", "Camera mounting boxes", "Nos.", len(cams), "CCTV", "1 per camera", w_cam)
    put("ip65_box", "IP65 junction boxes (outdoor cameras)", "Nos.", outdoor, "CCTV", "bullet / PTZ / ANPR cameras")

    # containment from drawn routes
    tray = sum(route_len_m(r, l, s) for r, l in m.routes if r.kind == "tray")
    conduit = sum(route_len_m(r, l, s) for r, l in m.routes if r.kind == "conduit")
    put("tray_m", "Cable tray", "Mtrs.", math.ceil(tray * k), "Containment", "Σ drawn tray routes + wastage")
    put("conduit_m", "PVC conduit 25 mm", "Mtrs.", math.ceil(conduit * k), "Containment", "Σ drawn conduit routes + wastage")
    put("saddle", "Saddles / clamps", "Nos.", math.ceil(conduit * k / 0.6), "Containment", "1 per 0.6 m of conduit")
    put("bend", "PVC bends", "Nos.", math.ceil(conduit / 8), "Containment", "1 per 8 m of conduit")
    put("coupler", "PVC couplers", "Nos.", math.ceil(conduit / 3), "Containment", "1 per 3 m of conduit")

    # overrides
    ov = {o.key: o for o in db.scalars(select(QuantityOverride).where(QuantityOverride.project_id == m.project.id))}
    for key, v in q.items():
        o = ov.get(key)
        v["override"] = o.value if o else None
        v["reason"] = o.reason if o else ""
        v["value"] = o.value if o else v["calc"]
    return q


# ---------------- BOQ ----------------
SECTIONS = ["Network – Material", "Network – Services", "Wi-Fi & Firewall", "CCTV", "Telephony", "Access Control",
            "AV & Conference", "Other IT", "Installation Materials"]
CAT_SECTION = {"Wireless": "Wi-Fi & Firewall", "CCTV": "CCTV", "Telephony": "Telephony", "Cabling": "Installation Materials"}
OTHER_SECTION = {"FW": "Wi-Fi & Firewall", "BIO": "Access Control", "ACD": "Access Control", "DC": "Access Control",
                 "TV": "AV & Conference", "HDMI": "AV & Conference", "VC": "AV & Conference",
                 "PR": "Other IT", "UPS": "Other IT", "SRV": "Other IT"}


def _rate(item: CatalogueItem | None):
    if not item:
        return 0.0, "missing"
    if item.vendor_rate is not None:
        return item.vendor_rate, "vendor"
    return item.indicative_rate, "indicative"


def boq(db: Session, m: Model, q: dict | None = None, pm: dict | None = None) -> dict:
    s = m.s
    pm = pm or port_matrix(db, m)
    q = q or quantities(db, m, pm)
    items = db.scalars(select(CatalogueItem).join(CatalogueCategory)).all()
    by_code = {i.code: i for i in items if i.code}

    def first(symbol, contains=""):
        cands = [i for i in items if i.category.symbol == symbol and i.is_active and contains in i.model]
        return cands[0] if cands else None

    points_p1 = sum(1 for r in pm["rows"] if r["phase"] == "Phase 1")
    frac1 = points_p1 / len(pm["rows"]) if pm["rows"] else 1.0
    lines: list[dict] = []

    def add(key, section, item, qty, kind="material", phase1=None, weights=None, remarks="", desc=None, uom=None):
        if qty <= 0:
            return
        rate, src = _rate(item)
        lines.append({
            "key": key, "section": section, "kind": kind,
            "description": desc or (item.description if item else key), "specs": item.specs if item else "",
            "brand": item.manufacturer if item else "", "model": item.model if item and not item.code else "",
            "uom": uom or (item.uom if item else "Nos."), "qty": qty,
            "phase1": phase1 if phase1 is not None else round(qty * frac1, 2 if qty % 1 else 0),
            "rate": rate, "rate_source": src, "gst_pct": item.gst_pct if item else 18,
            "install_rate": item.install_rate if item and kind == "material" else 0,
            "remarks": remarks, "weights": dict(weights or {}), "catalogue_item_id": item.id if item else None,
            "calc_qty": qty, "edited": [],
        })

    V = lambda k: q[k]["value"] if k in q else 0
    W = lambda k: q[k]["weights"] if k in q else {}

    # placed items, grouped by catalogue item
    grouped: dict[int, dict] = {}
    for c in m.ctx:
        if c.cat.symbol in POINT_SYMBOLS or c.cat.symbol in CALC_SYMBOLS:
            continue
        g = grouped.setdefault(c.item.id, {"c": c, "n": 0, "p1": 0, "w": defaultdict(float)})
        g["n"] += 1
        g["p1"] += c.pl.phase == "Phase 1"
        g["w"][c.fkey] += 1
    for iid, g in grouped.items():
        c = g["c"]
        sec = ("Network – Material" if c.cat.group == "Networking" else CAT_SECTION.get(c.cat.group)
               or OTHER_SECTION.get(c.cat.symbol, "Other IT"))
        add(f"item:{iid}", sec, c.item, g["n"], phase1=g["p1"], weights=g["w"])

    nm, ns = "Network – Material", "Network – Services"
    add("switches", nm, first("SW"), V("switches"), weights=W("switches"), remarks=q["switches"]["basis"] if "switches" in q else "")
    add("patch_panels", nm, first("PP"), V("patch_panels"), weights=W("patch_panels"))
    add("liu_field", nm, first("LIU", "12"), V("liu_field"), weights=W("liu_field"))
    add("liu_core", nm, first("LIU", "24"), V("liu_core"))
    add("sfp", nm, first("SFP"), V("sfp"), weights=W("sfp"))
    add("fiber_m", nm, by_code.get("fiber_cable"), V("fiber_m"), weights=W("fiber_m"))
    add("fiber_patch", nm, by_code.get("fiber_patch"), V("fiber_patch"), weights=W("fiber_patch"))
    add("hdpe_pipe", nm, by_code.get("hdpe_pipe"), V("fiber_m"), weights=W("fiber_m"))
    add("rj45_io", nm, by_code.get("cat6_io"), V("rj45_io"), weights=W("rj45_io"))
    add("faceplate_dual", nm, by_code.get("faceplate_dual"), V("faceplate_dual"), weights=W("faceplate_dual"))
    add("faceplate_quad", nm, by_code.get("faceplate_quad"), V("faceplate_quad"), weights=W("faceplate_quad"))
    add("gang_box", nm, by_code.get("gang_box"), V("gang_box"), weights=W("gang_box"))
    add("patch_cord_1m", nm, by_code.get("patch_cord_1m"), V("patch_cord_1m"), weights=W("patch_cord_1m"))
    add("patch_cord_2m", nm, by_code.get("patch_cord_2m"), V("patch_cord_2m"), weights=W("patch_cord_2m"))
    add("cat6_rolls", nm, by_code.get("cat6_cable"), V("cat6_rolls"), weights=W("cat6_rolls"),
        remarks=f"{V('cat6_m'):.0f} m")
    add("cat6a_rolls", nm, by_code.get("cat6a_cable"), V("cat6a_rolls"), weights=W("cat6a_rolls"),
        remarks=f"{V('cat6a_m'):.0f} m")
    add("pdu", nm, by_code.get("pdu"), V("pdu"), weights=W("pdu"))
    add("cable_manager", nm, by_code.get("cable_manager"), V("cable_manager"), weights=W("cable_manager"))
    if V("points_total"):
        add("misc", nm, by_code.get("misc"), 1)

    add("svc_fiber_laying", ns, by_code.get("svc_fiber_laying"), V("fiber_m"), "service", weights=W("fiber_m"))
    add("svc_hdpe_laying", ns, by_code.get("svc_hdpe_laying"), V("fiber_m"), "service", weights=W("fiber_m"))
    add("svc_splicing", ns, by_code.get("svc_splicing"), V("splicing"), "service", weights=W("splicing"))
    add("svc_io_punching", ns, by_code.get("svc_io_punching"), V("rj45_io"), "service", weights=W("rj45_io"))
    add("svc_cat6_laying", ns, by_code.get("svc_cat6_laying"), V("cat6_m") + V("cat6a_m"), "service", weights=W("points_total"))
    add("svc_testing", ns, by_code.get("svc_testing"), V("points_total"), "service", weights=W("points_total"))
    add("svc_tray_install", ns, by_code.get("svc_tray_install"), V("tray_m"), "service")
    add("svc_conduit_laying", ns, by_code.get("svc_conduit_laying"), V("conduit_m"), "service")

    if not any(c.cat.symbol == "NVR" for c in m.ctx):
        add("nvr", "CCTV", first("NVR"), V("nvr"), remarks="suggested — no NVR placed")
    add("hdd", "CCTV", by_code.get("hdd"), V("hdd"), remarks=q["hdd"]["basis"] if "hdd" in q else "")
    add("camera_box", "CCTV", by_code.get("camera_box"), V("camera_box"), weights=W("camera_box"))
    add("ip65_box", "CCTV", by_code.get("ip65_box"), V("ip65_box"))
    if V("points_voice") and not any(c.cat.symbol == "PBX" for c in m.ctx):
        add("pbx", "Telephony", first("PBX"), 1, remarks="suggested — phones placed but no IP PBX")

    im = "Installation Materials"
    add("tray", im, by_code.get("tray"), V("tray_m"))
    add("conduit", im, by_code.get("conduit_25"), V("conduit_m"))
    add("saddle", im, by_code.get("saddle"), V("saddle"))
    add("bend", im, by_code.get("bend"), V("bend"))
    add("coupler", im, by_code.get("coupler"), V("coupler"))

    # user edits and manual lines
    edits = db.scalars(select(BoqLine).where(BoqLine.project_id == m.project.id)).all()
    by_key = {e.key: e for e in edits if not e.is_manual}
    out = []
    for ln in lines:
        e = by_key.get(ln["key"])
        if e:
            if e.data.get("hidden"):
                continue
            for k, v in e.data.items():
                if k in ln and v is not None and v != "":
                    ln[k] = v
                    ln["edited"].append(k)
            if "rate" in e.data and e.data["rate"] not in (None, ""):
                ln["rate_source"] = "manual"
        out.append(ln)
    for e in edits:
        if e.is_manual:
            d = e.data
            out.append({"key": f"manual:{e.id}", "id": e.id, "section": d.get("section") or "Other IT", "kind": d.get("kind", "material"),
                        "description": d.get("description", ""), "specs": d.get("specs", ""), "brand": d.get("brand", ""),
                        "model": d.get("model", ""), "uom": d.get("uom", "Nos."), "qty": float(d.get("qty") or 0),
                        "phase1": float(d.get("phase1") if d.get("phase1") not in (None, "") else d.get("qty") or 0),
                        "rate": float(d.get("rate") or 0), "rate_source": "manual", "gst_pct": float(d.get("gst_pct", 18) or 0),
                        "install_rate": float(d.get("install_rate") or 0), "remarks": d.get("remarks", ""),
                        "weights": {}, "manual": True, "calc_qty": None, "edited": []})
    order = {s_: i for i, s_ in enumerate(SECTIONS)}
    out.sort(key=lambda l: (order.get(l["section"], 99), 0 if l.get("kind") == "material" else 1))
    for i, ln in enumerate(out, 1):
        ln["sn"] = i
        ln["phase1"] = min(float(ln["phase1"]), float(ln["qty"]))
        ln["phase2"] = round(float(ln["qty"]) - ln["phase1"], 2)
        ln["material"] = round(float(ln["qty"]) * float(ln["rate"]), 2)
        ln["install"] = round(float(ln["qty"]) * float(ln["install_rate"]), 2)
        ln["gst"] = round((ln["material"] + ln["install"]) * float(ln["gst_pct"]) / 100, 2)
        ln["total"] = round(ln["material"] + ln["install"] + ln["gst"], 2)
    return {"lines": out, "sections": [s_ for s_ in SECTIONS if any(l["section"] == s_ for l in out)]
            + sorted({l["section"] for l in out} - set(SECTIONS))}


# ---------------- budget ----------------
def budget(m: Model, b: dict) -> dict:
    s = m.s
    lines = b["lines"]

    def agg(keyfn):
        out = defaultdict(lambda: {"material": 0.0, "install": 0.0, "gst": 0.0})
        for ln in lines:
            for k, frac in keyfn(ln):
                for f in ("material", "install", "gst"):
                    out[k][f] += ln[f] * frac
        return out

    def floor_split(ln):
        w = ln.get("weights") or {}
        tot = sum(w.values())
        if not tot:
            return [("Common", 1.0)]
        return [(k, v / tot) for k, v in w.items()]

    def phase_split(ln):
        q = float(ln["qty"]) or 1
        return [("Phase 1", ln["phase1"] / q), ("Phase 2", ln["phase2"] / q)] if float(ln["qty"]) else [("Phase 1", 1.0)]

    def finish(d: dict, label_fn=lambda k: k):
        rows = []
        for k, v in d.items():
            sub = v["material"] + v["install"]
            cont = sub * s["contingency_pct"] / 100
            rows.append({"key": k, "label": label_fn(k), **{f: round(x, 2) for f, x in v.items()},
                         "contingency": round(cont, 2), "total": round(sub + v["gst"] + cont, 2)})
        return sorted(rows, key=lambda r: -r["total"])

    floor_lbl = lambda k: k if k == "Common" else " – ".join(m.floors.get(k, (k, "")))
    by_floor = agg(floor_split)
    by_building = defaultdict(lambda: {"material": 0.0, "install": 0.0, "gst": 0.0})
    for k, v in by_floor.items():
        bk = k.split("|")[0]
        for f in v:
            by_building[bk][f] += v[f]
    bname = {b_.code: b_.name for b_ in m.project.buildings}

    material = sum(l["material"] for l in lines)
    install = sum(l["install"] for l in lines)
    gst = sum(l["gst"] for l in lines)
    cont = (material + install) * s["contingency_pct"] / 100
    vendor = sum(l["material"] for l in lines if l["rate_source"] == "vendor")
    manual = sum(l["material"] for l in lines if l["rate_source"] == "manual")
    return {
        "material": round(material, 2), "install": round(install, 2), "gst": round(gst, 2),
        "contingency_pct": s["contingency_pct"], "contingency": round(cont, 2),
        "total": round(material + install + gst + cont, 2),
        "pct_vendor": round(100 * vendor / material, 1) if material else 0,
        "pct_manual": round(100 * manual / material, 1) if material else 0,
        "missing_rates": [l["description"] for l in lines if not l["rate"]],
        "by_section": finish(agg(lambda l: [(l["section"], 1.0)])),
        "by_phase": finish(agg(phase_split)),
        "by_floor": finish(by_floor, floor_lbl),
        "by_building": finish(by_building, lambda k: bname.get(k, k)),
    }


def compute_all(db: Session, p: Project) -> dict:
    m = load(db, p)
    pm = port_matrix(db, m)
    q = quantities(db, m, pm)
    b = boq(db, m, q, pm)
    return {"model": m, "pm": pm, "q": q, "boq": b, "budget": budget(m, b)}
