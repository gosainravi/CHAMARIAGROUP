"""Excel (openpyxl) and PDF (PyMuPDF + Pillow) deliverables."""
from __future__ import annotations

import io
import math
from datetime import date

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from PIL import Image, ImageDraw, ImageFont

from .calc import summary_matrix

HEAD = PatternFill("solid", fgColor="1F3A68")
SUB = PatternFill("solid", fgColor="DCE6F5")
EDIT = PatternFill("solid", fgColor="FFF2CC")
WHITE = Font(color="FFFFFF", bold=True)
BOLD = Font(bold=True)
thin = Side(style="thin", color="B7C0CC")
BOX = Border(left=thin, right=thin, top=thin, bottom=thin)
INR = '#,##0'


def _title(ws, text, sub, ncols):
    ws.append([text]); ws["A1"].font = Font(bold=True, size=14)
    ws.append([sub]); ws["A2"].font = Font(italic=True, color="667085")
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=ncols)


def _header(ws, cols, widths=None):
    ws.append(cols)
    r = ws.max_row
    for i, _ in enumerate(cols, 1):
        c = ws.cell(r, i)
        c.fill, c.font, c.border = HEAD, WHITE, BOX
        c.alignment = Alignment(wrap_text=True, vertical="center", horizontal="center")
    if widths:
        for i, w in enumerate(widths, 1):
            ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = f"A{r + 1}"
    return r


def _box(ws, r1, r2, ncols):
    for r in range(r1, r2 + 1):
        for c in range(1, ncols + 1):
            ws.cell(r, c).border = BOX


def _bytes(wb):
    b = io.BytesIO(); wb.save(b); return b.getvalue()


PM_COLS = ["S.No", "Building", "Floor", "Room / Location", "Equipment ID", "Equipment Description", "Network Point Type",
           "Cable", "Rack Number", "Switch Number", "Switch Port Number", "Patch Panel Number", "Patch Panel Port Number",
           "Cable ID", "Destination", "VLAN", "Length (m)", "Phase", "Remarks"]
PM_W = [6, 14, 12, 22, 17, 34, 12, 8, 16, 20, 9, 20, 9, 22, 28, 7, 9, 9, 24]


def _pm_row(r):
    return [r["sn"], r["building"], r["floor"], r["room"], r["equip_code"], r["description"], r["point_type"], r["cable"],
            r["rack"], r["switch"], r["switch_port"], r["patch_panel"], r["pp_port"], r["cable_id"], r["destination"],
            r["vlan"], r["length_m"], r["phase"], r["remarks"]]


def port_matrix_xlsx(project, pm: dict) -> bytes:
    wb = Workbook()
    # 1. Summary in the PORT MATIRX.xlsx layout
    sm = summary_matrix(pm)
    ws = wb.active; ws.title = "Port Matrix Summary"
    _title(ws, f"PORT Matrix Complete for {project.name}", f"{project.client} · {project.location} · generated {date.today():%d-%b-%Y}", 12)
    labels = {"Data": "Lan/Data/Cat6", "Printer": "printer/data/cat6", "Voice": "voice/data/cat6", "CCTV": "cctv/cat6",
              "Wi-Fi": "Wi-Fi/cat6A", "Access": "Access control / Attendance", "AV": "TV / AV DATA/cat6"}
    h = _header(ws, ["S.No", "Location", "Floor", "Building"] + [labels[t] for t in sm["types"]] + ["Total", "Rack"],
                [6, 34, 14, 14] + [12] * len(sm["types"]) + [8, 22])
    for i, row in enumerate(sm["rows"], 1):
        ws.append([i, row["location"], row["floor"], row["building"]] + [row[t] or None for t in sm["types"]] + [None, row["racks"]])
        r = ws.max_row
        ws.cell(r, 5 + len(sm["types"])).value = f"=SUM({get_column_letter(5)}{r}:{get_column_letter(4 + len(sm['types']))}{r})"
    last = ws.max_row
    ws.append(["", "Total", "", ""] + [f"=SUM({get_column_letter(5 + i)}{h + 1}:{get_column_letter(5 + i)}{last})"
                                        for i in range(len(sm["types"]) + 1)])
    for c in ws[ws.max_row]:
        c.font, c.fill = BOLD, SUB
    _box(ws, h, ws.max_row, 6 + len(sm["types"]))

    # 2. Complete port-level matrix
    ws = wb.create_sheet("Complete Port Matrix")
    _title(ws, f"Port Matrix – {project.name}", "Cells shaded yellow were changed by hand.", len(PM_COLS))
    h = _header(ws, PM_COLS, PM_W)
    colmap = {"switch_no": 10, "switch_port": 11, "pp_no": 12, "pp_port": 13, "destination": 15, "vlan": 16, "remarks": 19, "rack": 9}
    for r in pm["rows"]:
        ws.append(_pm_row(r))
        for k in r["overridden"]:
            if k in colmap:
                ws.cell(ws.max_row, colmap[k]).fill = EDIT
    _box(ws, h, ws.max_row, len(PM_COLS))
    ws.auto_filter.ref = f"A{h}:{get_column_letter(len(PM_COLS))}{ws.max_row}"

    # 3. Rack-wise & switch-wise
    ws = wb.create_sheet("Rack & Switch")
    _title(ws, "Rack-wise and switch-wise allocation", "", 7)
    h = _header(ws, ["Rack", "Model", "Building", "Floor", "Points", "Switches", "Patch panels"], [20, 18, 14, 14, 9, 9, 11])
    for rk in pm["racks"]:
        ws.append([rk["code"], rk["model"], rk["building"], rk["floor"], rk["points"], rk["switches"], rk["patch_panels"]])
    _box(ws, h, ws.max_row, 7)
    ws.append([])
    h2 = ws.max_row + 1
    _header(ws, ["Switch", "Ports used", "Data", "Voice", "CCTV", "Wi-Fi", "Other"])
    sw = {}
    for r in pm["rows"]:
        if r["switch"]:
            d = sw.setdefault(r["switch"], {"n": 0, "Data": 0, "Voice": 0, "CCTV": 0, "Wi-Fi": 0, "Other": 0})
            d["n"] += 1
            d[r["point_type"] if r["point_type"] in d else "Other"] += 1
    for k in sorted(sw):
        d = sw[k]; ws.append([k, d["n"], d["Data"], d["Voice"], d["CCTV"], d["Wi-Fi"], d["Other"]])
    _box(ws, h2, ws.max_row, 7)

    # 4. One sheet per building
    for b in sorted({r["building"] for r in pm["rows"]}):
        ws = wb.create_sheet(f"Bldg {b}"[:31])
        _title(ws, f"Port Matrix – {b}", "", len(PM_COLS))
        h = _header(ws, PM_COLS, PM_W)
        for r in pm["rows"]:
            if r["building"] == b:
                ws.append(_pm_row(r))
        _box(ws, h, ws.max_row, len(PM_COLS))

    # 5. Validation
    ws = wb.create_sheet("Validation")
    _title(ws, "Validation", f"{sum(i['level'] == 'error' for i in pm['issues'])} errors, "
                             f"{sum(i['level'] == 'warning' for i in pm['issues'])} warnings", 3)
    h = _header(ws, ["Level", "Check", "Message"], [10, 22, 100])
    for i in pm["issues"]:
        ws.append([i["level"], i["code"], i["message"]])
    return _bytes(wb)


BOQ_COLS = ["S. No.", "Category", "Description of Items", "Technical Specifications", "Brand", "Model Number", "UOM",
            "Full BOQ", "1st Phase Qty", "Phase 2 Qty", "Unit Price (₹)", "Installation (₹/unit)", "GST %",
            "Phase 1 Amount", "Phase 2 Amount", "Material Amount", "Installation Amount", "GST Amount", "Total Amount",
            "Rate source", "Remarks"]
BOQ_W = [6, 16, 42, 26, 12, 16, 7, 9, 9, 9, 12, 11, 6, 14, 14, 14, 13, 13, 15, 11, 30]


def boq_xlsx(project, b: dict, budget: dict) -> bytes:
    """Layout follows boq -pujaso.xlsx: Full BOQ / 1st Phase / Phase 2 = Full − Phase 1, live formulas."""
    wb = Workbook()
    ws = wb.active; ws.title = "BOQ"
    _title(ws, f"Estimated IT work for {project.name}", f"{project.client} · {project.location} · rates ex-GST · "
                                                         f"generated {date.today():%d-%b-%Y}", len(BOQ_COLS))
    h = _header(ws, BOQ_COLS, BOQ_W)
    sec_totals = []
    for sec in b["sections"]:
        ws.append([sec]); r = ws.max_row
        ws.cell(r, 1).font = BOLD
        for c in range(1, len(BOQ_COLS) + 1):
            ws.cell(r, c).fill = SUB
        first = r + 1
        n = 0
        for ln in b["lines"]:
            if ln["section"] != sec:
                continue
            n += 1
            ws.append([n, ln["section"], ln["description"], ln["specs"], ln["brand"], ln["model"], ln["uom"],
                       ln["qty"], ln["phase1"], None, ln["rate"], ln["install_rate"], ln["gst_pct"] / 100,
                       None, None, None, None, None, None, ln["rate_source"], ln["remarks"]])
            r = ws.max_row
            ws[f"J{r}"] = f"=H{r}-I{r}"
            ws[f"N{r}"] = f"=K{r}*I{r}"
            ws[f"O{r}"] = f"=K{r}*J{r}"
            ws[f"P{r}"] = f"=K{r}*H{r}"
            ws[f"Q{r}"] = f"=L{r}*H{r}"
            ws[f"R{r}"] = f"=(P{r}+Q{r})*M{r}"
            ws[f"S{r}"] = f"=P{r}+Q{r}+R{r}"
            ws[f"M{r}"].number_format = "0%"
            for col in "KLNOPQRS":
                ws[f"{col}{r}"].number_format = INR
            for k in ln.get("edited", []):
                idx = {"description": 3, "specs": 4, "brand": 5, "model": 6, "qty": 8, "phase1": 9, "rate": 11,
                       "install_rate": 12, "gst_pct": 13, "remarks": 21}.get(k)
                if idx:
                    ws.cell(r, idx).fill = EDIT
            ws.cell(r, 3).alignment = Alignment(wrap_text=True, vertical="top")
        last = ws.max_row
        ws.append(["", "", f"Sub-total – {sec}"] + [""] * 10 + [f"=SUM({c}{first}:{c}{last})" for c in "NOPQRS"])
        r = ws.max_row
        for c in range(1, len(BOQ_COLS) + 1):
            ws.cell(r, c).font = BOLD
        for col in "NOPQRS":
            ws[f"{col}{r}"].number_format = INR
        sec_totals.append(r)
    ws.append([])
    def total_row(label, formulas):
        ws.append(["", "", label] + [""] * 10 + formulas)
        r = ws.max_row
        for c in range(1, len(BOQ_COLS) + 1):
            ws.cell(r, c).font = BOLD
        for col in "NOPQRS":
            ws[f"{col}{r}"].number_format = INR
        return r
    tr = total_row("Total", [f"={'+'.join(f'{c}{r}' for r in sec_totals) or 0}" for c in "NOPQRS"])
    cr = total_row(f"Contingency {budget['contingency_pct']}% (on material + installation)",
                   ["", "", "", "", "", f"=(P{tr}+Q{tr})*{budget['contingency_pct']}/100"])
    total_row("Grand Total (incl. GST and contingency)", ["", "", "", "", "", f"=S{tr}+S{cr}"])
    _box(ws, h, ws.max_row, len(BOQ_COLS))
    ws.auto_filter.ref = f"A{h}:{get_column_letter(len(BOQ_COLS))}{h}"

    # Budget sheet
    ws = wb.create_sheet("IT Budget")
    _title(ws, f"Approximate IT Budget – {project.name}",
           f"Preliminary estimate, not a quotation. {budget['pct_vendor']}% of material value on vendor rates.", 7)
    for label, key in [("Category-wise", "by_section"), ("Building-wise", "by_building"), ("Floor-wise", "by_floor"), ("Phase-wise", "by_phase")]:
        ws.append([]); ws.append([label]); ws.cell(ws.max_row, 1).font = Font(bold=True, size=12)
        h = _header(ws, ["Head", "Material", "Installation", "GST", "Contingency", "Total"], [34, 15, 15, 15, 15, 16])
        for row in budget[key]:
            ws.append([row["label"], row["material"], row["install"], row["gst"], row["contingency"], row["total"]])
            for c in range(2, 7):
                ws.cell(ws.max_row, c).number_format = INR
        _box(ws, h, ws.max_row, 6)
    ws.append([])
    for label, v in [("Material cost", budget["material"]), ("Installation cost", budget["install"]), ("GST", budget["gst"]),
                     (f"Contingency {budget['contingency_pct']}%", budget["contingency"]), ("Total estimated project cost", budget["total"])]:
        ws.append([label, v]); ws.cell(ws.max_row, 2).number_format = INR; ws.cell(ws.max_row, 1).font = BOLD
    return _bytes(wb)


def schedule_xlsx(project, m, q: dict) -> bytes:
    wb = Workbook()
    ws = wb.active; ws.title = "Equipment Schedule"
    _title(ws, f"Equipment Placement Schedule – {project.name}", "", 11)
    h = _header(ws, ["S.No", "Equipment ID", "Category", "Make", "Model", "Building", "Floor", "Room", "Layout", "Phase", "Points"],
                [6, 18, 22, 14, 20, 14, 14, 22, 20, 9, 7])
    for i, c in enumerate(m.ctx, 1):
        ws.append([i, c.pl.equip_code, c.cat.name, c.item.manufacturer, c.item.model, c.building.name, c.floor.name,
                   c.pl.room, c.layout.name, c.pl.phase, c.pl.ports])
    _box(ws, h, ws.max_row, 11)
    ws = wb.create_sheet("Category Summary")
    cats = {}
    for c in m.ctx:
        cats.setdefault((c.cat.group, c.cat.name), 0)
        cats[(c.cat.group, c.cat.name)] += 1
    h = _header(ws, ["Group", "Category", "Qty"], [16, 28, 8])
    for (g, n), v in sorted(cats.items()):
        ws.append([g, n, v])
    ws = wb.create_sheet("Building Summary")
    blds = sorted({c.building.name for c in m.ctx})
    names = sorted({c.cat.name for c in m.ctx})
    h = _header(ws, ["Category"] + blds + ["Total"], [28] + [14] * (len(blds) + 1))
    for n in names:
        row = [sum(1 for c in m.ctx if c.cat.name == n and c.building.name == b) for b in blds]
        ws.append([n] + row + [sum(row)])
    ws = wb.create_sheet("Quantities")
    h = _header(ws, ["Group", "Item", "Unit", "Calculated", "Adjusted", "Used", "Basis", "Reason"], [16, 34, 8, 11, 11, 11, 60, 30])
    for v in q.values():
        ws.append([v["group"], v["label"], v["unit"], v["calc"], v["override"], v["value"], v["basis"], v["reason"]])
        if v["override"] is not None:
            ws.cell(ws.max_row, 5).fill = EDIT
    return _bytes(wb)


# ---------------- drawings ----------------
ROUTE_COLORS = {"cat6": "#2563eb", "cat6a": "#7c3aed", "fiber": "#ea580c", "tray": "#a16207", "conduit": "#64748b"}


def _font(sz):
    for name in ("arialbd.ttf", "DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(name, sz)
        except OSError:
            continue
    return ImageFont.load_default()


def render_layout(layout, m, routes, mode="all", max_px=3000) -> Image.Image:
    """mode: all | routing (routes + racks only) | equipment."""
    img = Image.open(layout.image_path).convert("RGB")
    sc = min(1.0, max_px / max(img.size))
    if sc < 1:
        img = img.resize((int(img.width * sc), int(img.height * sc)))
    # fade the drawing so equipment stands out
    img = Image.blend(img, Image.new("RGB", img.size, "white"), 0.35)
    d = ImageDraw.Draw(img)
    unit = max(img.size) / 130
    if mode in ("all", "routing"):
        for r in routes:
            pts = [(r.points[i] * sc, r.points[i + 1] * sc) for i in range(0, len(r.points) - 1, 2)]
            if len(pts) >= 2:
                d.line(pts, fill=ROUTE_COLORS.get(r.kind, "#000"), width=max(2, int(unit * 0.25)))
    f = _font(max(10, int(unit * 0.6)))
    fs = _font(max(8, int(unit * 0.45)))
    for c in m.ctx:
        if c.layout.id != layout.id:
            continue
        if mode == "routing" and c.cat.symbol != "RK":
            continue
        x, y = c.pl.x * sc, c.pl.y * sc
        w, h = unit * 2.4, unit * 1.3
        d.rounded_rectangle([x - w / 2, y - h / 2, x + w / 2, y + h / 2], radius=h / 2, fill=c.cat.color, outline="white", width=2)
        d.text((x, y), c.cat.symbol, fill="white", font=f, anchor="mm")
        d.text((x, y + h / 2 + 2), c.pl.equip_code, fill="black", font=fs, anchor="mt", stroke_width=2, stroke_fill="white")
    return img


def drawings_pdf(project, m, layouts_routes, mode="all") -> bytes:
    import pymupdf
    doc = pymupdf.open()
    for layout, routes in layouts_routes:
        img = render_layout(layout, m, routes, mode)
        page = doc.new_page(width=1190, height=842)  # A3 landscape pt
        title = {"all": "Final IT Infrastructure Layout", "routing": "Fibre and Cat6 Routing Layout",
                 "equipment": "Equipment Placement"}[mode]
        page.insert_text((30, 32), f"{project.name} – {title}", fontsize=14)
        page.insert_text((30, 50), f"{layout.floor.building.name} · {layout.floor.name} · {layout.name}", fontsize=10, color=(0.4, 0.4, 0.4))
        b = io.BytesIO(); img.save(b, "JPEG", quality=82, optimize=True)
        r = pymupdf.Rect(30, 60, 1160, 760)
        page.insert_image(r, stream=b.getvalue(), keep_proportion=True)
        # legend
        y = 790
        x = 30
        cats = sorted({(c.cat.symbol, c.cat.name, c.cat.color) for c in m.ctx if c.layout.id == layout.id and (mode != "routing" or c.cat.symbol == "RK")})
        for sym, name, color in cats[:12]:
            rgb = tuple(int(color[i:i + 2], 16) / 255 for i in (1, 3, 5))
            page.draw_rect(pymupdf.Rect(x, y - 8, x + 18, y + 2), color=rgb, fill=rgb)
            page.insert_text((x + 22, y), f"{sym} {name}", fontsize=7)
            x += 92
        if mode in ("all", "routing"):
            x = 30
            for k, col in ROUTE_COLORS.items():
                rgb = tuple(int(col[i:i + 2], 16) / 255 for i in (1, 3, 5))
                page.draw_line((x, 815), (x + 20, 815), color=rgb, width=2)
                page.insert_text((x + 24, 818), k.upper(), fontsize=7)
                x += 70
    if not len(doc):
        page = doc.new_page()
        page.insert_text((50, 80), "No layouts in this project.", fontsize=14)
    return doc.tobytes(garbage=3, deflate=True)
