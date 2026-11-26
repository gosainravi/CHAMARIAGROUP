"""Equipment catalogue seed. Indicative rates are ex-GST (INR), taken from the Chhata reference
workbooks where available (Budget sheet / boq -pujaso); others are placeholders to be replaced
with vendor quotes."""
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
