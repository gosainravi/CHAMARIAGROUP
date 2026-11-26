"""Runs against the dev Postgres (docker compose up -d). Each test cleans up its own project."""
import io

import ezdxf
import pymupdf
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def project(client):
    r = client.post("/api/projects", json={"name": "Test Plant", "client": "ACME", "num_buildings": 2, "num_floors": 2})
    assert r.status_code == 201, r.text
    p = r.json()
    yield p
    client.delete(f"/api/projects/{p['id']}")


def _png():
    b = io.BytesIO()
    Image.new("RGB", (800, 600), "white").save(b, "PNG")
    return b.getvalue()


def _pdf(pages=2):
    doc = pymupdf.open()
    for i in range(pages):
        pg = doc.new_page(width=842, height=595)
        pg.insert_text((50, 50), f"Floor plan sheet {i + 1}")
        pg.draw_rect(pymupdf.Rect(100, 100, 700, 500))
    return doc.tobytes()


def _dxf():
    doc = ezdxf.new()
    msp = doc.modelspace()
    msp.add_lwpolyline([(0, 0), (20000, 0), (20000, 12000), (0, 12000)], close=True)
    msp.add_line((10000, 0), (10000, 12000))
    s = io.StringIO()
    doc.write(s)
    return s.getvalue().encode()


def test_structure_created(project):
    assert [b["code"] for b in project["buildings"]] == ["B1", "B2"]
    assert [f["code"] for f in project["buildings"][0]["floors"]] == ["GF", "FF"]


@pytest.mark.parametrize("fname,data,pages", [("plan.png", _png(), 1), ("plan.pdf", _pdf(2), 2), ("plan.dxf", _dxf(), 1)])
def test_upload_formats(client, project, fname, data, pages):
    fid = project["buildings"][0]["floors"][0]["id"]
    r = client.post(f"/api/floors/{fid}/layouts", files={"file": (fname, data)}, data={"name": "Admin GF"})
    assert r.status_code == 201, r.text
    created = r.json()["created"]
    assert len(created) == pages
    img = client.get(f"/api/layouts/{created[0]['id']}/image")
    assert img.status_code == 200 and img.content[:4] == b"\x89PNG"


def test_rejects_bad_type(client, project):
    fid = project["buildings"][0]["floors"][0]["id"]
    r = client.post(f"/api/floors/{fid}/layouts", files={"file": ("x.txt", b"hi")})
    assert r.status_code == 415


def test_placements_ids_never_reused(client, project):
    fid = project["buildings"][0]["floors"][1]["id"]
    lid = client.post(f"/api/floors/{fid}/layouts", files={"file": ("p.png", _png())}).json()["created"][0]["id"]
    cat = client.get("/api/catalogue").json()
    cam = next(c for c in cat if c["symbol"] == "CAM")["items"][0]["id"]
    lan = next(c for c in cat if c["symbol"] == "NO")["items"][0]["id"]
    r = client.put(f"/api/layouts/{lid}/content", json={"placements": [
        {"catalogue_item_id": cam, "x": 10, "y": 10}, {"catalogue_item_id": cam, "x": 20, "y": 20},
        {"catalogue_item_id": lan, "x": 30, "y": 30}], "annotations": [{"x": 5, "y": 5, "text": "Server room"}]})
    assert r.status_code == 200, r.text
    pl = r.json()["placements"]
    assert [p["equip_code"] for p in pl] == ["B1-FF-CAM-001", "B1-FF-CAM-002", "B1-FF-NO-001"]
    assert pl[2]["ports"] == 2  # dual outlet default
    # delete CAM-002, add another camera → gets 003, not 002
    keep = [dict(id=p["id"], catalogue_item_id=p["catalogue_item_id"], x=p["x"], y=p["y"]) for p in pl if p["equip_code"] != "B1-FF-CAM-002"]
    r = client.put(f"/api/layouts/{lid}/content", json={"placements": keep + [{"catalogue_item_id": cam, "x": 1, "y": 1}]})
    codes = sorted(p["equip_code"] for p in r.json()["placements"])
    assert codes == ["B1-FF-CAM-001", "B1-FF-CAM-003", "B1-FF-NO-001"]
    assert r.json()["annotations"] == []
    # scale
    r = client.patch(f"/api/layouts/{lid}", json={"scale_m_per_px": 0.02})
    assert r.json()["scale_m_per_px"] == 0.02
    assert client.patch(f"/api/layouts/{lid}", json={"scale_m_per_px": -1}).status_code == 422


def test_catalogue_crud(client):
    cat = client.get("/api/catalogue").json()
    assert len(cat) >= 30
    r = client.post("/api/catalogue/items", json={"category_id": cat[0]["id"], "manufacturer": "TestCo", "model": "X1", "indicative_rate": 99})
    iid = r.json()["id"]
    assert client.patch(f"/api/catalogue/items/{iid}", json={"vendor_rate": 88}).json()["vendor_rate"] == 88
    assert client.delete(f"/api/catalogue/items/{iid}").json()["deleted"] is True
