"""Rule-based equipment placement from room names read on the drawing.

Each room label that matches a rule gets a typical IT fit-out (racks, APs, cameras, LAN/voice points,
TV/VC, printers, biometric). Everything comes back as suggestions; the user accepts or rejects them.
Rules follow common office/plant practice and the Chhata PORT MATIRX conventions."""
from __future__ import annotations

import math
import re

# (pattern, [(symbol, model_hint), ...], note)
RULES: list[tuple[str, list[tuple[str, str]], str]] = [
    (r"server|data ?cent|hub room|\bit room|rack room|comms?", [("RK", "42U"), ("FW", ""), ("UPS", ""), ("ACD", ""), ("CAM", "")],
     "Core rack, firewall, UPS, access-controlled door and camera in the server room"),
    (r"confer|confr|board ?room", [("TV", ""), ("VC", ""), ("HDMI", ""), ("NO", ""), ("PH", ""), ("AP", "")],
     "Conference: display, video conferencing, HDMI, data + voice, Wi-Fi"),
    (r"meeting", [("TV", ""), ("NO", ""), ("PH", ""), ("AP", "")], "Meeting room: display, data, phone, Wi-Fi"),
    (r"director|chairman|\bceo\b|\bmd\b", [("NO", ""), ("PH", ""), ("AP", ""), ("TV", "")], "Director's office"),
    (r"cabin|office|chamber|manager|account|\bhr\b|admin room", [("NO", ""), ("PH", "")], "Cabin: data + voice"),
    (r"reception|front desk", [("AP", ""), ("CAM", ""), ("NO", ""), ("PH", "")], "Reception: Wi-Fi, camera, data, phone"),
    (r"lobby|foyer|waiting", [("AP", ""), ("CAM", "")], "Lobby: Wi-Fi and camera"),
    (r"dining|canteen|cafeteria|\bmess\b|seating", [("AP", ""), ("CAM", ""), ("CAM", "")], "Dining: Wi-Fi and cameras"),
    (r"kitchen|pantry|dish", [("CAM", "")], "Kitchen / pantry camera"),
    (r"passage|corridor", [("CAM", "")], "Corridor camera"),
    (r"\bstair|\blift\b", [("CAM", "")], "Stair / lift lobby camera"),
    (r"entry|entrance|\bgate\b|main door", [("CAM", ""), ("BIO", "")], "Entry: camera and attendance machine"),
    (r"locker|shower|changing", [("CAM", "")], "Locker area camera"),
    (r"electrical", [("RK", "9U")], "Network node cabinet in the electrical room"),
    (r"store|storage|godown|warehouse|compactor", [("CAM", "")], "Store camera"),
    (r"printer", [("PR", "")], "Printer position marked on the drawing"),
    (r"biomatrix|biometric|attendance|punch", [("BIO", "")], "Biometric marked on the drawing"),
    (r"game|recreation|training|auditorium|\bgym\b", [("AP", ""), ("TV", ""), ("NO", "")], "Recreation / training room"),
    (r"production|plant|machine|section|shop ?floor|factory|lamination|extrusion|printing|slitting",
     [("AP", ""), ("CAM", ""), ("CAM", ""), ("NO", "")], "Production area"),
    (r"guard|security", [("CAM", ""), ("NO", ""), ("PH", "")], "Guard room"),
]
WORKSTATION = re.compile(r"work ?station|open office|staff area|workstation", re.I)
SEATS = re.compile(r"(\d+)\s*(person|persons|person's|seat|seats|nos|pax)", re.I)
SKIP = re.compile(r"toilet|\bwc\b|duct|shaft|sink|bench|console|split|almirah|almirha", re.I)
DEDUPE_M = {"CAM": 6, "AP": 10, "RK": 15, "PR": 1, "BIO": 4, "TV": 3, "VC": 3, "FW": 3, "UPS": 3, "ACD": 3}


def suggest_rules(layout, labels: list[dict], seats_default: int = 8) -> list[dict]:
    m2px = 1 / layout.scale_m_per_px if layout.scale_m_per_px else max(layout.width, layout.height) / 150
    out: list[dict] = []

    def add(sym, hint, x, y, room, reason):
        lim = DEDUPE_M.get(sym)
        if lim and any(o["symbol"] == sym and math.hypot(o["x"] - x, o["y"] - y) < lim * m2px for o in out):
            return
        out.append({"symbol": sym, "model_hint": hint, "x": round(min(max(x, 0), layout.width), 1),
                    "y": round(min(max(y, 0), layout.height), 1), "room": room[:100], "reason": reason, "source": "rules"})

    # label positions with merged multi-line context ("WORK STATION" + "18 PERSON'S" nearby)
    for lab in labels:
        text = lab["text"]
        if SKIP.search(text):
            continue
        x, y = lab["x"], lab["y"]
        room = re.sub(r"\s+", " ", text).strip()
        if WORKSTATION.search(text):
            ctx = " ".join(l["text"] for l in labels if math.hypot(l["x"] - x, l["y"] - y) < 4 * m2px)
            mm = SEATS.search(ctx)
            n = min(int(mm.group(1)), 200) if mm else seats_default
            if any(o["symbol"] == "DP" and math.hypot(o["x"] - x, o["y"] - y) < 8 * m2px for o in out):
                continue  # same workstation block labelled twice ("WORK STATION" + "WORK STATION 18 PERSON'S")
            cols = max(1, math.ceil(math.sqrt(n * 2)))
            sp = 1.5 * m2px
            for i in range(n):
                r, c = divmod(i, cols)
                dx = (c - (cols - 1) / 2) * sp
                dy = (r - (math.ceil(n / cols) - 1) / 2) * sp + 1.2 * m2px
                add("DP", "", x + dx, y + dy, room, f"Workstation seat {i + 1} of {n}: data point")
                add("PH", "", x + dx + 0.5 * m2px, y + dy, room, f"Workstation seat {i + 1} of {n}: IP phone")
            add("AP", "", x, y - 1.5 * m2px, room, f"Wi-Fi for {n}-seat workstation area")
            for k in range(max(0, math.ceil(n / 20) - 1)):
                add("AP", "", x + (k + 1) * 10 * m2px, y, room, "Additional AP for large workstation area")
            continue
        for pattern, items, note in RULES:
            if re.search(pattern, text, re.I):
                for i, (sym, hint) in enumerate(items):
                    ang = 2 * math.pi * i / max(len(items), 1)
                    rad = 1.2 * m2px if len(items) > 1 else 0.6 * m2px
                    add(sym, hint, x + rad * math.cos(ang), y + 0.8 * m2px + rad * math.sin(ang), room, note)
                break

    # Wi-Fi gap fill: every labelled indoor space should have an AP within ~12 m
    for lab in labels:
        if SKIP.search(lab["text"]) or not any(re.search(p_, lab["text"], re.I) for p_, _i, _n in RULES) and not WORKSTATION.search(lab["text"]):
            continue
        if not any(o["symbol"] == "AP" and math.hypot(o["x"] - lab["x"], o["y"] - lab["y"]) < 12 * m2px for o in out):
            add("AP", "", lab["x"], lab["y"] - 1 * m2px, lab["text"], "Wi-Fi coverage: no AP within 12 m of this room")

    # make sure there is at least one rack, and every point is within ~80 m of one (Cat6 limit 90 m incl. patching)
    racks = [o for o in out if o["symbol"] == "RK"]
    endpoints = [o for o in out if o["symbol"] not in ("RK", "FW", "UPS")]
    if not racks and endpoints:
        cx = sum(o["x"] for o in endpoints) / len(endpoints)
        cy = sum(o["y"] for o in endpoints) / len(endpoints)
        add("RK", "9U", cx, cy, "", "No server/electrical room found: node cabinet at the centre of the equipment")
        racks = [out[-1]]
    if layout.scale_m_per_px:
        for _ in range(20):
            far = [o for o in endpoints if min(abs(o["x"] - r["x"]) + abs(o["y"] - r["y"]) for r in racks) * layout.scale_m_per_px > 80]
            if not far:
                break
            f = far[0]
            out.append({"symbol": "RK", "model_hint": "9U", "x": f["x"] + 1.5 * m2px, "y": f["y"], "room": f["room"],
                        "reason": "Extra node cabinet: points here are more than 80 m from the nearest rack", "source": "rules"})
            racks.append(out[-1])
    return out
