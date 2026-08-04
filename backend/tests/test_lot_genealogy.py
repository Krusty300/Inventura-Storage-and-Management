from tests.conftest import client
from tests.test_manufacturing import (
    _create_bom,
    _create_wo,
    _make_location,
    _make_product,
    _receive,
)


def test_wo_complete_creates_lot_links(auth_headers):
    fg = _make_product(auth_headers, "GL-FG")
    comp = _make_product(auth_headers, "GL-COMP")
    loc = _make_location(auth_headers, "GL-LOC")
    out = _make_location(auth_headers, "GL-OUT")
    assert _receive(auth_headers, comp["id"], 10, loc["id"], lot_number="GL-RAW").status_code == 201
    bom = _create_bom(auth_headers, fg["id"], [(comp["id"], 2)]).json()
    wo = _create_wo(auth_headers, fg["id"], 3, bom_id=bom["id"]).json()
    client.post(f"/api/work-orders/{wo['id']}/release", headers=auth_headers)
    client.post(f"/api/work-orders/{wo['id']}/complete", json={
        "receive_location_id": out["id"], "lot_number": "GL-FG", "backflush": True,
    }, headers=auth_headers)

    fg_lots = client.get("/api/lots", params={"product_id": fg["id"]}, headers=auth_headers).json()
    fg_lot_id = next(l["id"] for l in fg_lots["items"] if l["lot_number"] == "GL-FG")
    raw_lots = client.get("/api/lots", params={"product_id": comp["id"]}, headers=auth_headers).json()
    raw_lot_id = raw_lots["items"][0]["id"]

    gen = client.get(f"/api/lots/{raw_lot_id}/genealogy", headers=auth_headers).json()
    assert gen["lot_number"] == "GL-RAW"
    assert gen["children"][0]["lot_number"] == "GL-FG"
    assert gen["children"][0]["quantity"] == 6
    assert gen["affected"][0]["lot_number"] == "GL-FG"

    gen_fg = client.get(f"/api/lots/{fg_lot_id}/genealogy", headers=auth_headers).json()
    assert gen_fg["parents"][0]["lot_number"] == "GL-RAW"
    assert gen_fg["children"] == []

    wo_gen = client.get(f"/api/work-orders/{wo['id']}/genealogy", headers=auth_headers).json()
    assert any(c["lot_number"] == "GL-RAW" and c["quantity"] == 6 for c in wo_gen["component_lots"])
    assert any(f["lot_number"] == "GL-FG" and f["quantity"] == 3 for f in wo_gen["fg_lots"])
    assert len(wo_gen["links"]) == 1
    assert wo_gen["links"][0]["parent_lot_number"] == "GL-RAW"
    assert wo_gen["links"][0]["child_lot_number"] == "GL-FG"


def test_recall_walks_multi_level_genealogy(auth_headers):
    raw = _make_product(auth_headers, "RL-RAW")
    sub = _make_product(auth_headers, "RL-SUB")
    final = _make_product(auth_headers, "RL-FIN")
    loc = _make_location(auth_headers, "RL-LOC")
    out = _make_location(auth_headers, "RL-OUT")
    assert _receive(auth_headers, raw["id"], 50, loc["id"], lot_number="RL-RAW-LOT").status_code == 201
    bom_sub = _create_bom(auth_headers, sub["id"], [(raw["id"], 1)]).json()
    bom_fin = _create_bom(auth_headers, final["id"], [(sub["id"], 1)]).json()

    wo1 = _create_wo(auth_headers, sub["id"], 2, bom_id=bom_sub["id"]).json()
    client.post(f"/api/work-orders/{wo1['id']}/release", headers=auth_headers)
    client.post(f"/api/work-orders/{wo1['id']}/complete", json={
        "receive_location_id": out["id"], "lot_number": "RL-SUB-LOT", "backflush": True,
    }, headers=auth_headers)

    wo2 = _create_wo(auth_headers, final["id"], 1, bom_id=bom_fin["id"]).json()
    client.post(f"/api/work-orders/{wo2['id']}/release", headers=auth_headers)
    client.post(f"/api/work-orders/{wo2['id']}/complete", json={
        "receive_location_id": out["id"], "lot_number": "RL-FIN-LOT", "backflush": True,
    }, headers=auth_headers)

    raw_lots = client.get("/api/lots", params={"product_id": raw["id"]}, headers=auth_headers).json()
    raw_lot_id = raw_lots["items"][0]["id"]
    gen = client.get(f"/api/lots/{raw_lot_id}/genealogy", headers=auth_headers).json()
    by_number = {a["lot_number"]: a for a in gen["affected"]}
    assert by_number["RL-SUB-LOT"]["depth"] == 1
    assert by_number["RL-FIN-LOT"]["depth"] == 2
    assert by_number["RL-FIN-LOT"]["product_name"] == final["name"]

    sub_gen = client.get(
        f"/api/lots/{by_number['RL-SUB-LOT']['lot_id']}/genealogy", headers=auth_headers
    ).json()
    assert any(p["lot_number"] == "RL-RAW-LOT" for p in sub_gen["parents"])
    assert any(c["lot_number"] == "RL-FIN-LOT" for c in sub_gen["children"])


def test_wo_without_fg_lot_creates_no_links(auth_headers):
    fg = _make_product(auth_headers, "GL2-FG")
    comp = _make_product(auth_headers, "GL2-COMP")
    loc = _make_location(auth_headers, "GL2-LOC")
    out = _make_location(auth_headers, "GL2-OUT")
    assert _receive(auth_headers, comp["id"], 10, loc["id"], lot_number="GL2-RAW").status_code == 201
    bom = _create_bom(auth_headers, fg["id"], [(comp["id"], 1)]).json()
    wo = _create_wo(auth_headers, fg["id"], 1, bom_id=bom["id"]).json()
    client.post(f"/api/work-orders/{wo['id']}/release", headers=auth_headers)
    client.post(f"/api/work-orders/{wo['id']}/complete", json={
        "receive_location_id": out["id"], "backflush": True,
    }, headers=auth_headers)

    raw_lots = client.get("/api/lots", params={"product_id": comp["id"]}, headers=auth_headers).json()
    raw_lot_id = raw_lots["items"][0]["id"]
    gen = client.get(f"/api/lots/{raw_lot_id}/genealogy", headers=auth_headers).json()
    assert gen["children"] == []
    assert gen["affected"] == []
    wo_gen = client.get(f"/api/work-orders/{wo['id']}/genealogy", headers=auth_headers).json()
    assert wo_gen["component_lots"] != []
    assert wo_gen["fg_lots"] == []
    assert wo_gen["links"] == []
