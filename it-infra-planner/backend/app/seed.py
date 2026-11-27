"""Equipment catalogue seed. Indicative rates are ex-GST (INR), taken from the Chhata reference
workbooks where available (Budget sheet / boq -pujaso); others are placeholders to be replaced
with vendor quotes."""
from pathlib import Path

from sqlalchemy.orm import Session
from .models import CatalogueCategory, CatalogueItem

# (group, name, layer, symbol, color, point_type, ports_required, [items])
# item = (manufacturer, model, description, specs, uom, rate, install_rate)
CATALOGUE = [
    ("Networking", "User LAN Point", "Network", "LAN", "#2563eb", "Data", 1, [
        ("Commscope", "Cat6 I/O + Face plate", "User LAN point (RJ45 I/O, face plate, gang box)", "Cat6 UTP, dual face plate", "Nos.", 400, 150)]),
    ("Networking", "RJ45 Data Point", "Network", "DP", "#3b82f6", "Data", 1, [
        ("Commscope", "Cat6 I/O", "RJ45 data point", "Cat6 keystone jack", "Nos.", 400, 150)]),
    ("Networking", "Network Outlet (Dual)", "Network", "NO", "#60a5fa", "Data", 2, [
        ("Commscope", "Dual outlet", "Dual RJ45 network outlet", "2 x Cat6 I/O", "Nos.", 800, 300)]),
    ("Networking", "Network Switch", "Network", "SW", "#0f766e", "", 0, [
        ("Aruba", "JL684B 1930 24G PoE", "Aruba Instant On 1930 24G 4SFP+ 370W", "24x1G PoE+, 4xSFP+, 370 W", "Nos.", 50000, 1500),
        ("D-Link", "DGS-1210-28P", "D-Link 24 port PoE managed switch", "24x1G PoE, 4xSFP", "Nos.", 28000, 1500)]),
    ("Networking", "Core Switch", "Network", "CSW", "#115e59", "", 0, [
        ("Aruba", "CX 6100 24G 4SFP+", "Core / aggregation switch", "24x1G, 4x10G SFP+", "Nos.", 120000, 5000)]),
    ("Networking", "Distribution Switch", "Network", "DSW", "#134e4a", "", 0, [
        ("Aruba", "1930 24G 4SFP+", "Distribution switch (non-PoE)", "24x1G, 4xSFP+", "Nos.", 35000, 2000)]),
    ("Networking", "Network Rack", "Network", "RK", "#475569", "", 0, [
        ("Comm Rack", "9U 600x600", "9U wall-mount rack 600 x 600", "Wall mount, glass door", "Nos.", 7500, 1500),
        ("Comm Rack", "12U 600x600", "12U wall-mount rack 600 x 600", "Wall mount", "Nos.", 10000, 1500),
        ("Comm Rack", "24U 600x800", "24U floor rack", "Floor standing", "Nos.", 30000, 3000),
        ("APW President", "42U 800x1000", "42U rack complete with trays, PDU, accessories", "Floor standing", "Nos.", 50000, 5000)]),
    ("Networking", "Patch Panel", "Network", "PP", "#64748b", "", 0, [
        ("Commscope", "24 port unloaded", "Commscope 24 port patch panel (unloaded)", "1U, 24 port", "Nos.", 5310, 0)]),
    ("Networking", "LIU", "Fiber", "LIU", "#ea580c", "", 0, [
        ("Commscope", "LIU 6 port loaded", "6 port LIU fully loaded", "SC/LC, 6 port", "Nos.", 4000, 500),
        ("Commscope", "LIU 12 port loaded", "12 port LIU fully loaded", "SC/LC, 12 port", "Nos.", 6000, 500),
        ("Commscope", "LIU 24 port loaded", "24 port LIU fully loaded (server room)", "24 port", "Nos.", 8000, 500)]),
    ("Networking", "SFP Module", "Fiber", "SFP", "#f97316", "", 0, [
        ("Aruba", "J9151E 10G", "Aruba SFP+ 10G LR module", "10G, SM, LC", "Nos.", 6000, 0)]),
    ("Networking", "Fiber Termination Point", "Fiber", "FTP", "#fb923c", "", 0, [
        ("Generic", "FTB", "Fiber termination box", "Wall mount", "Nos.", 1500, 300)]),
    ("Cabling", "Cable Tray", "Cabling", "CT", "#a16207", "", 0, [
        ("Generic", "Perforated 100mm", "Perforated cable tray 100 mm", "GI", "Mtrs.", 450, 120)]),
    ("Cabling", "Conduit Junction", "Cabling", "JB", "#ca8a04", "", 0, [
        ("Generic", "PVC junction box", "PVC junction / inspection box", "", "Nos.", 60, 20)]),
    ("Wireless", "Indoor AP", "Wireless", "AP", "#7c3aed", "Wi-Fi", 1, [
        ("Aruba", "IAP505", "Aruba Instant AP 505 (Wi-Fi 6)", "Up to ~1.87 Gbps", "Nos.", 40000, 1000),
        ("Aruba", "IAP515", "Aruba Instant AP 515 (Wi-Fi 6)", "Up to ~2.69 Gbps", "Nos.", 55000, 1000)]),
    ("Wireless", "Outdoor AP", "Wireless", "OAP", "#6d28d9", "Wi-Fi", 1, [
        ("Aruba", "AP-575", "Aruba outdoor AP", "IP67", "Nos.", 90000, 2500)]),
    ("CCTV", "Dome Camera", "CCTV", "CAM", "#dc2626", "CCTV", 1, [
        ("CP Plus", "DA41L3C-D-LQ", "CP Plus 4MP dome camera, 30 m IR, vandal proof", "4MP, IR 30 m", "Nos.", 4000, 800)]),
    ("CCTV", "Bullet Camera", "CCTV", "BUL", "#b91c1c", "CCTV", 1, [
        ("CP Plus", "TA41L3C-D-LQ", "CP Plus 4MP bullet camera, 30 m IR, weather proof", "4MP, IR 30 m, IP67", "Nos.", 6800, 800),
        ("CP Plus", "Bullet IVS", "CP Plus bullet with tripwire / intrusion", "4MP, analytics", "Nos.", 8500, 800)]),
    ("CCTV", "PTZ Camera", "CCTV", "PTZ", "#991b1b", "CCTV", 1, [
        ("CP Plus", "PTZ 25x", "CP Plus 4MP PTZ 25x", "4MP, 25x optical", "Nos.", 45000, 2500)]),
    ("CCTV", "ANPR Camera", "CCTV", "ANPR", "#7f1d1d", "CCTV", 1, [
        ("CP Plus", "TT41L3CMD-Q", "ANPR 4MP camera", "4MP ANPR", "Nos.", 80830, 3000)]),
    ("CCTV", "NVR", "CCTV", "NVR", "#450a0a", "", 1, [
        ("CP Plus", "32 ch 4322VK", "CP Plus 32 channel NVR", "32 ch, 4 SATA", "Nos.", 20000, 2000),
        ("CP Plus", "64 ch", "CP Plus 64 channel NVR", "64 ch, 8 SATA", "Nos.", 50000, 3000)]),
    ("Telephony", "IP Phone", "Telephony", "PH", "#059669", "Voice", 1, [
        ("Grandstream", "GRP2601P", "Grandstream IP phone", "PoE, 2 SIP", "Nos.", 3500, 200)]),
    ("Telephony", "Analog Phone", "Telephony", "APH", "#10b981", "Voice", 1, [
        ("Syntel", "KTX", "Syntel KTX phone", "", "Nos.", 8000, 200)]),
    ("Telephony", "IP PBX", "Telephony", "PBX", "#047857", "", 1, [
        ("Matrix", "IPBAX 64 SIP", "Syntel/Matrix IPBAX (4 CO / 64 SIP ext / 30 SIP trunk)", "64 SIP ext", "Nos.", 80000, 10000)]),
    ("Other IT", "Printer", "Other", "PR", "#0891b2", "Printer", 1, [
        ("Generic", "Network MFP", "Network printer / MFP", "", "Nos.", 30000, 500)]),
    ("Other IT", "Biometric Machine", "Access", "BIO", "#db2777", "Access", 1, [
        ("Generic", "Fingerprint", "Fingerprint attendance machine", "", "Nos.", 22000, 1000),
        ("Generic", "Face detection", "Face detection attendance machine", "", "Nos.", 30000, 1000)]),
    ("Other IT", "Access Control Door", "Access", "ACD", "#be185d", "Access", 1, [
        ("Generic", "Reader + lock + exit", "Access-controlled door: reader, EM lock, exit switch", "", "Set", 26000, 2000)]),
    ("Other IT", "Door Controller", "Access", "DC", "#9d174d", "Access", 1, [
        ("Generic", "Gateway", "Access control gateway / door controller", "", "Nos.", 12000, 1000)]),
    ("Other IT", "Conference Room TV", "AV", "TV", "#4f46e5", "AV", 1, [
        ("Generic", "65in", "Conference room TV 65\"", "", "Nos.", 85000, 2000)]),
    ("Other IT", "HDMI Connection", "AV", "HDMI", "#6366f1", "", 0, [
        ("Generic", "HDMI run", "HDMI point with cable cubby", "", "Nos.", 3000, 500)]),
    ("Other IT", "Video Conferencing", "AV", "VC", "#4338ca", "AV", 1, [
        ("Generic", "VC kit", "Video conferencing bar + mic", "", "Nos.", 150000, 5000)]),
    ("Other IT", "Firewall", "Network", "FW", "#1e293b", "", 0, [
        ("Fortinet", "FortiGate 80F", "FortiGate 80F with 3 year subscription", "", "Nos.", 200000, 5000)]),
    ("Other IT", "UPS", "Power", "UPS", "#334155", "", 0, [
        ("Generic", "3 kVA rack", "Rack UPS 3 kVA for server room", "", "Nos.", 50000, 1000)]),
    ("Other IT", "Server", "Network", "SRV", "#0f172a", "Data", 2, [
        ("Generic", "Rack server", "Rack server", "", "Nos.", 250000, 5000)]),
]


def seed_catalogue(db: Session) -> None:
    if db.query(CatalogueCategory).count():
        return
    for i, (group, name, layer, sym, color, pt, ports, items) in enumerate(CATALOGUE):
        cat = CatalogueCategory(group=group, name=name, layer=layer, symbol=sym, color=color,
                                point_type=pt, ports_required=ports, sort=i)
        db.add(cat)
        for man, model, desc, specs, uom, rate, inst in items:
            cat.items.append(CatalogueItem(manufacturer=man, model=model, description=desc, specs=specs,
                                           uom=uom, indicative_rate=rate, install_rate=inst))
    db.commit()


# Non-placeable items the BOQ engine derives from the port matrix. code = rule key.
# (code, description, specs, uom, rate, install_rate)
MATERIALS = [
    ("cat6_io", "Cat6 I/O (RJ45 keystone jack)", "Commscope Cat6 UTP", "Nos.", 250, 0),
    ("faceplate_dual", "Face Plate Dual", "2 port, with shutter", "Nos.", 80, 0),
    ("faceplate_quad", "Face Plate Quad", "4 port", "Nos.", 120, 0),
    ("gang_box", "Gang box for user-end points (CCTV, Wi-Fi, user)", "GI / PVC", "Nos.", 40, 0),
    ("patch_cord_1m", "Patch Cord 1M (panel end) - Commscope", "Cat6 1 m", "Nos.", 150, 0),
    ("patch_cord_2m", "Patch Cord 2M (user end) - Commscope", "Cat6 2 m", "Nos.", 180, 0),
    ("cat6_cable", "Cat6 Cable Roll Commscope 24AWG (305 m)", "Cat6 UTP 23/24 AWG", "Roll", 13000, 0),
    ("cat6a_cable", "Cat6A Cable Roll (305 m)", "Cat6A U/FTP", "Roll", 26000, 0),
    ("cat6a_patch", "Cat6A Patch Cord", "Cat6A 2 m", "Nos.", 250, 0),
    ("fiber_cable", "6 Core SM Fiber Cable Armoured - Commscope", "Single mode, armoured", "Mtrs.", 80, 0),
    ("fiber_patch", "Fiber Patch Cord (3 meter) - Commscope", "LC-LC SM duplex", "Nos.", 1000, 0),
    ("pdu", "PDU for rack", "6 socket", "Nos.", 2300, 0),
    ("cable_manager", "Cable Manager 1U", "1U horizontal", "Nos.", 600, 0),
    ("hdd", "WD 8TB Surveillance HDD", "8 TB", "Nos.", 18000, 0),
    ("camera_box", "Accessories for Camera PVC/MS Box", "", "Nos.", 150, 0),
    ("ip65_box", "IP65 junction box - outdoor cameras", "", "Nos.", 150, 0),
    ("conduit_25", "PVC rigid conduit 25 mm, ISI medium duty", "", "Mtrs.", 30, 0),
    ("hdpe_pipe", "HDPE Pipe / Conduit pipe for Fiber Cables", "", "Mtrs.", 45, 0),
    ("tray", "Perforated cable tray 100 mm", "GI", "Mtrs.", 450, 0),
    ("saddle", "Saddles / spacer clamps with screws & rawl plugs", "", "Nos.", 3, 0),
    ("bend", "PVC bends / elbows (mixed sizes)", "", "Nos.", 10, 0),
    ("coupler", "PVC couplers (mixed sizes)", "", "Nos.", 6, 0),
    ("misc", "Cable ties, Velcro, labels & markers", "", "Lot", 5000, 0),
]
SERVICES = [
    ("svc_fiber_laying", "Fiber Cable Laying Charges", "Mtrs.", 40),
    ("svc_hdpe_laying", "HDPE / Conduit Pipe 1\" Laying Charges fiber cable", "Mtrs.", 25),
    ("svc_splicing", "Splicing of Fiber Cable", "Core", 150),
    ("svc_io_punching", "Cat6 I/O Punching at Single End", "Nos.", 50),
    ("svc_cat6_laying", "Cat6 Cable Laying Charges", "Mtrs.", 15),
    ("svc_conduit_laying", "PVC Conduit Laying Charges", "Mtrs.", 20),
    ("svc_tray_install", "Cable Tray Installation Charges", "Mtrs.", 120),
    ("svc_testing", "Cat6 Cable Testing & Ferruling", "Nos.", 50),
]


def seed_extras(db: Session) -> None:
    def cat(name, group, sym):
        c = db.query(CatalogueCategory).filter_by(name=name).first()
        if not c:
            c = CatalogueCategory(group=group, name=name, layer="Other", symbol=sym, color="#94a3b8",
                                  point_type="", ports_required=0, sort=900, placeable=False)
            db.add(c)
            db.flush()
        return c
    have = {c for (c,) in db.query(CatalogueItem.code).filter(CatalogueItem.code.isnot(None))}
    mat = cat("Passive Material", "Materials", "MAT")
    for code, desc, specs, uom, rate, inst in MATERIALS:
        if code not in have:
            db.add(CatalogueItem(category_id=mat.id, manufacturer="Commscope" if "Commscope" in desc else "Generic",
                                 model=code, description=desc, specs=specs, uom=uom, indicative_rate=rate,
                                 install_rate=inst, code=code))
    svc = cat("Services", "Services", "SVC")
    for code, desc, uom, rate in SERVICES:
        if code not in have:
            db.add(CatalogueItem(category_id=svc.id, manufacturer="Installer", model=code, description=desc,
                                 uom=uom, indicative_rate=rate, gst_pct=18, code=code))
    db.commit()


# Vendor quotes are business data: they live in data/vendor_quotes.local.json on this PC (git-ignored) and are loaded
# on startup if present. Format: {"quote_ref", "quotes": [{"match": ["code", x] | ["model", SYMBOL, text],
# "rates": {vendor: rate}}], "extra_models": [...], "install_rates": [{"match": [...], "rate": n}]}.
QUOTES_FILE = Path(__file__).resolve().parent.parent / "data" / "vendor_quotes.local.json"


def _find(db: Session, match):
    if match[0] == "code":
        return db.query(CatalogueItem).filter_by(code=match[1]).first()
    return (db.query(CatalogueItem).join(CatalogueCategory).filter(CatalogueCategory.symbol == match[1])
            .filter(CatalogueItem.model.contains(match[2])).first())


def seed_quotes(db: Session) -> None:
    import json
    from .models import VendorQuote
    if not QUOTES_FILE.exists():
        return
    cfg = json.loads(QUOTES_FILE.read_text(encoding="utf-8"))
    for m in cfg.get("extra_models", []):
        cat = db.query(CatalogueCategory).filter_by(symbol=m["symbol"]).first()
        if cat and not db.query(CatalogueItem).filter_by(category_id=cat.id, model=m["model"]).first():
            db.add(CatalogueItem(category_id=cat.id, manufacturer=m["manufacturer"], model=m["model"],
                                 description=m["description"], specs=m.get("specs", ""), indicative_rate=m["rate"],
                                 install_rate=m.get("install_rate", 1000)))
    db.flush()
    ref = cfg.get("quote_ref", "local")
    if db.query(VendorQuote).filter_by(quote_ref=ref).first():
        return
    for q in cfg.get("quotes", []):
        item = _find(db, q["match"])
        if not item:
            continue
        for vendor, rate in q["rates"].items():
            db.add(VendorQuote(catalogue_item_id=item.id, vendor=vendor, rate=rate, quote_ref=ref))
        if item.vendor_rate is None:
            item.vendor_rate = min(q["rates"].values())  # cheapest real quote becomes the vendor rate
    for r in cfg.get("install_rates", []):
        item = _find(db, r["match"])
        if item:
            item.install_rate = r["rate"]
    db.commit()
