import pymupdf
import pytest
from fastapi.testclient import TestClient

from app.main import app
from tests.test_api import _png


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def proj(client):
    p = client.post("/api/projects", json={"name": "P5 Test"}).json()
    yield p
    client.delete(f"/api/projects/{p['id']}")


def _pdf_with_rooms():
    doc = pymupdf.open(); pg = doc.new_page(width=800, height=600)
    pg.insert_text((100, 100), "RECEPTION"); pg.insert_text((500, 400), "SERVER ROOM"); pg.insert_text((300, 500), "1200")
    return doc.tobytes()


def test_room_labels(client, proj):
    fid = proj["buildings"][0]["floors"][0]["id"]
    l = client.post(f"/api/floors/{fid}/layouts", files={"file": ("plan.pdf", _pdf_with_rooms())}).json()["created"][0]
    labels = client.get(f"/api/layouts/{l['id']}/room-labels").json()["labels"]
    texts = {x["text"] for x in labels}
    assert {"RECEPTION", "SERVER ROOM"} <= texts and "1200" not in texts
    rec = next(x for x in labels if x["text"] == "RECEPTION")
    z = l["width"] / 800
    assert abs(rec["x"] - 130 * z) < 60 * z and abs(rec["y"] - 97 * z) < 20 * z


def test_quotes_compare_versions(client, proj):
    fid = proj["buildings"][0]["floors"][0]["id"]
    lid = client.post(f"/api/floors/{fid}/layouts", files={"file": ("p.png", _png())}).json()["created"][0]["id"]
    cat = {c["symbol"]: c for c in client.get("/api/catalogue").json()}
    cam = cat["CAM"]["items"][0]["id"]
    rk = cat["RK"]["items"][0]["id"]
    client.put(f"/api/layouts/{lid}/content", json={"placements": [
        {"catalogue_item_id": rk, "x": 10, "y": 10, "room": "Store"}] + [{"catalogue_item_id": cam, "x": 50, "y": 50, "room": "Gate"}] * 4})
    q1 = client.post(f"/api/catalogue/items/{cam}/quotes", json={"vendor": "Gyan", "rate": 3500}).json()
    client.post(f"/api/catalogue/items/{cam}/quotes", json={"vendor": "Fastech", "rate": 3900})
    c = client.get(f"/api/projects/{proj['id']}/vendor-compare").json()
    row = next(r for r in c["rows"] if r["catalogue_item_id"] == cam)
    assert row["best_vendor"] == "Gyan" and c["totals"]["Gyan"] < c["totals"]["Fastech"]
    assert c["best_total"] <= c["current_total"]
    old = client.get("/api/catalogue").json()
    try:
        a = client.post(f"/api/projects/{proj['id']}/vendor-compare/apply", json={"vendor": "cheapest"}).json()
        assert a["updated_items"] >= 1
        item = next(i for k in client.get("/api/catalogue").json() for i in k["items"] if i["id"] == cam)
        assert item["vendor_rate"] == 3500
    finally:
        orig = next(i for k in old for i in k["items"] if i["id"] == cam)
        client.patch(f"/api/catalogue/items/{cam}", json={"vendor_rate": orig["vendor_rate"]})
        for qq in client.get(f"/api/catalogue/items/{cam}/quotes").json():
            client.delete(f"/api/quotes/{qq['id']}")
    # versions
    v = client.post(f"/api/projects/{proj['id']}/versions", json={"label": "Baseline"}).json()
    assert v["versions"][0]["summary"]["placements"] == 5
    vid = v["versions"][0]["id"]
    client.put(f"/api/layouts/{lid}/content", json={"placements": [{"catalogue_item_id": rk, "x": 10, "y": 10}]})
    assert client.get(f"/api/projects/{proj['id']}/versions").json()["current"]["placements"] == 1
    r = client.post(f"/api/versions/{vid}/restore").json()
    assert r["current"]["placements"] == 5 and len(r["versions"]) == 2
    codes = sorted(p["equip_code"] for p in client.get(f"/api/layouts/{lid}").json()["placements"])
    assert codes[0] == "B1-GF-CAM-001"
