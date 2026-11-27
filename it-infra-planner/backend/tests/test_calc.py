"""End-to-end: placements → quantities → port matrix → BOQ → budget → exports."""
import io
import math

import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook

from app.main import app
from tests.test_api import _png


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def setup(client):
    p = client.post("/api/projects", json={"name": "Calc Test", "num_buildings": 1, "num_floors": 1}).json()
    fid = p["buildings"][0]["floors"][0]["id"]
    lid = client.post(f"/api/floors/{fid}/layouts", files={"file": ("p.png", _png())}).json()["created"][0]["id"]
    client.patch(f"/api/layouts/{lid}", json={"scale_m_per_px": 0.05})  # 800 px = 40 m
    cat = {c["symbol"]: c for c in client.get("/api/catalogue").json()}
    it = lambda s, i=0: cat[s]["items"][i]["id"]
    pl = [{"catalogue_item_id": it("RK", 3), "x": 400, "y": 300, "room": "Server room"}]          # 42U → core
    pl += [{"catalogue_item_id": it("RK", 0), "x": 780, "y": 580, "room": "Store"}]               # 9U field rack
    pl += [{"catalogue_item_id": it("LAN"), "x": 100 + i * 10, "y": 100, "room": "Office"} for i in range(30)]
    pl += [{"catalogue_item_id": it("CAM"), "x": 700, "y": 500 + i, "room": "Yard", "phase": "Phase 2"} for i in range(5)]
    pl += [{"catalogue_item_id": it("AP"), "x": 300, "y": 200, "room": "Office"}]
    pl += [{"catalogue_item_id": it("PH"), "x": 120, "y": 120, "room": ""}]
    r = client.put(f"/api/layouts/{lid}/content", json={"placements": pl})
    assert r.status_code == 200, r.text
    client.put(f"/api/layouts/{lid}/routes", json=[{"kind": "conduit", "points": [0, 0, 200, 0, 200, 100]}])
    yield p["id"], lid
    client.delete(f"/api/projects/{p['id']}")


def test_quantities(client, setup):
    pid, _ = setup
    q = {x["key"]: x for x in client.get(f"/api/projects/{pid}/quantities").json()["quantities"]}
    assert q["points_total"]["value"] == 37
    assert q["rj45_io"]["value"] == 74
    assert q["cameras"]["value"] == 5
    assert q["racks"]["value"] == 2
    # 32 points on core rack (30 LAN + AP + phone) → ⌈32*1.2/24⌉ = 2 switches; 5 cams on field rack → 1
    assert q["switches"]["value"] == 3
    assert q["fiber_links"]["value"] == 1 and q["sfp"]["value"] == 2
    assert q["conduit_m"]["value"] == math.ceil(300 * 0.05 * 1.1)  # 15 m drawn + 10 %
    assert q["cat6a_m"]["value"] > 0  # Wi-Fi on Cat6A
    # override then clear
    r = client.put(f"/api/projects/{pid}/quantities/sfp", json={"value": 4, "reason": "spares"}).json()
    sfp = next(x for x in r["quantities"] if x["key"] == "sfp")
    assert sfp["value"] == 4 and sfp["calc"] == 2
    client.put(f"/api/projects/{pid}/quantities/sfp", json={"value": None})


def test_port_matrix_and_validation(client, setup):
    pid, _ = setup
    pm = client.get(f"/api/projects/{pid}/port-matrix").json()
    assert len(pm["rows"]) == 37
    first = pm["rows"][0]
    assert first["switch"].endswith("-SW01") and first["switch_port"] == 1 and first["cable_id"].endswith("-PP01-01")
    assert pm["summary"]["totals"]["total"] == 37
    assert any(i["code"] == "missing_room" for i in pm["issues"])  # phone has no room
    assert not any(i["code"].startswith("duplicate") for i in pm["issues"])
    # force a duplicate port: put row 2 on row 1's switch port
    r2 = pm["rows"][1]
    pm2 = client.put(f"/api/projects/{pid}/port-matrix", json={"placement_id": r2["placement_id"], "point_index": r2["point_index"],
                                                                "data": {"switch_port": 1, "vlan": 99}}).json()
    assert any(i["code"] == "duplicate_switch_port" for i in pm2["issues"])
    row = next(r for r in pm2["rows"] if r["placement_id"] == r2["placement_id"])
    assert row["vlan"] == 99 and "switch_port" in row["overridden"]
    # capacity
    client.put(f"/api/projects/{pid}/port-matrix", json={"placement_id": r2["placement_id"], "point_index": 0, "data": {"switch_no": 9}})
    pm3 = client.get(f"/api/projects/{pid}/port-matrix").json()
    assert any(i["code"] == "switch_capacity" for i in pm3["issues"])
    pm4 = client.post(f"/api/projects/{pid}/port-matrix/reset").json()
    assert not any(i["code"] in ("duplicate_switch_port", "switch_capacity") for i in pm4["issues"])
    wb = load_workbook(io.BytesIO(client.get(f"/api/projects/{pid}/port-matrix.xlsx").content))
    assert wb.sheetnames[:3] == ["Port Matrix Summary", "Complete Port Matrix", "Rack & Switch"]
    assert wb["Complete Port Matrix"].max_row == 3 + 37


def test_boq_budget_exports(client, setup):
    pid, lid = setup
    b = client.get(f"/api/projects/{pid}/boq").json()
    keys = {l["key"]: l for l in b["lines"]}
    assert keys["rj45_io"]["qty"] == 74 and keys["switches"]["qty"] == 3
    cam = next(l for l in b["lines"] if "dome" in l["description"].lower())
    assert cam["qty"] == 5 and cam["phase1"] == 0 and cam["phase2"] == 5
    bud = b["budget"]
    assert abs(bud["total"] - (bud["material"] + bud["install"] + bud["gst"] + bud["contingency"])) < 1
    assert abs(sum(r["total"] for r in bud["by_section"]) - bud["total"]) < 5
    assert abs(sum(r["total"] for r in bud["by_phase"]) - bud["total"]) < 5
    # edit rate → manual source; hide; manual line; reset
    b = client.put(f"/api/projects/{pid}/boq/switches", json={"data": {"rate": 1000}}).json()
    sw = next(l for l in b["lines"] if l["key"] == "switches")
    assert sw["rate"] == 1000 and sw["rate_source"] == "manual" and sw["material"] == 3000
    b = client.post(f"/api/projects/{pid}/boq", json={"data": {"description": "Laptop", "qty": 2, "rate": 80000}}).json()
    man = next(l for l in b["lines"] if l.get("manual"))
    assert man["material"] == 160000
    b = client.delete(f"/api/projects/{pid}/boq/hdd").json()
    assert "hdd" not in {l["key"] for l in b["lines"]}
    b = client.post(f"/api/projects/{pid}/boq/reset").json()
    assert "hdd" in {l["key"] for l in b["lines"]}
    wb = load_workbook(io.BytesIO(client.get(f"/api/projects/{pid}/boq.xlsx").content))
    assert wb.sheetnames == ["BOQ", "IT Budget"]
    assert str(wb["BOQ"]["J5"].value or "").startswith("=") or any(str(c.value).startswith("=H") for c in wb["BOQ"]["J"])
    assert client.get(f"/api/projects/{pid}/schedule.xlsx").status_code == 200
    pdf = client.get(f"/api/projects/{pid}/drawings.pdf?mode=routing")
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"
    assert client.get(f"/api/layouts/{lid}/render.png").content[:4] == b"\x89PNG"
    rep = client.get(f"/api/projects/{pid}/report").json()
    assert len(rep["schedule"]) == 39


def test_boq_compare(client, setup):
    pid, _ = setup
    from openpyxl import Workbook
    wb = Workbook(); ws = wb.active
    ws.append(["S. No.", "Description of Items", "UOM", "Full BOQ"])
    ws.append([1, "Cat6 I/O (RJ45 keystone jack)", "Nos.", 60])
    ws.append([2, "Something we never calculate", "Nos.", 3])
    b = io.BytesIO(); wb.save(b)
    r = client.post(f"/api/projects/{pid}/boq/compare", files={"file": ("old.xlsx", b.getvalue())}).json()
    m = next(x for x in r["rows"] if x["status"] == "matched")
    assert m["calc_key"] == "rj45_io" and m["delta"] == 14
    assert any(x["status"] == "only_imported" for x in r["rows"])
    assert any(x["status"] == "only_calculated" for x in r["rows"])


def test_suggest_grid_and_settings(client, setup):
    pid, lid = setup
    r = client.post(f"/api/layouts/{lid}/suggest", json={"mode": "grid"}).json()
    assert r["engine"] == "grid"
    s = client.put(f"/api/projects/{pid}/settings", json={"spare_pct": 0, "contingency_pct": 5}).json()
    assert s["values"]["spare_pct"] == 0
    q = {x["key"]: x for x in client.get(f"/api/projects/{pid}/quantities").json()["quantities"]}
    assert q["switches"]["value"] == 3  # 32/24 → 2, 5/24 → 1
    assert client.put(f"/api/projects/{pid}/settings", json={"switch_ports": 0}).status_code == 422
