# IT Infrastructure Layout, Port Matrix & BOQ Planner — First Deliverable

Status: **for approval — no development started.**
Reference files analysed (read-only):
`chatta project/IT infra chatta/IT infra/Base Network/PORT MATIRX.xlsx` and `boq -pujaso.xlsx`.

---

## 0. What the two reference files actually contain

### PORT MATIRX.xlsx (4 sheets)

| Sheet | What it is | Key structure |
|---|---|---|
| **Port Matrix** | Location × service **count** matrix (49 locations, Evolvepack/Chhata plant) | `S.No · Location · Floor` then one column per point type: `Lan/Data/Cat6 · printer/data/cat6 · voice/data/cat · cctv/cat6 · Wi-Fi/cat6A · Attendance Machine · TV · DATA/cat6 · DISH-RG6 · HDMI · POWER SOCKET · CABLE CUBBY · 9U/24U/42U Rack · Finger-print reader · Exit switch · Lock · Cat6 from server room · Cat6 lock→reader · Exit switch→switch`. Totals row 53 (`SUM`), row 55 `Total Data + Voice Points = D+E+F+G+H+K`. |
| **Budget** | Rough budget by section | `Points · multiple · qty · Per unit price · approx. cost`. Sections: Network, Cable Requirement, Access Control, CCTV, Other, recurring cost. Rules: `Patch panels = points / 24`, `PoE switches = points / 24`, 18 % tax on grand total. |
| **BOQ** | Same as Budget without prices | |
| **Sheet3** | Phase 1 / Phase 2 split (fibre, racks, field switches, attendance → phase 1; CCTV, Wi-Fi, access control, core, server room, IPBAX → phase 2) | |

Totals from the matrix: Data 65 · Printer 3 · Voice 100 · CCTV 99 · Wi-Fi 24 · DATA/cat6 (TV/AV) 18 → **309 network points**.

### boq -pujaso.xlsx (2 sheets)

| Sheet | Structure |
|---|---|
| **Final cs (3)** | `S.No · Description of Items · UOM · (calc) · (roll size) · Full BOQ · 1st Phase Qty · Phase 2 Qty (=Full−Ph1) · Make · Unit Price (₹) · Phase 1 amt · Phase 2 amt`. Sections: **Material** (racks, fibre, LIU, Aruba switches, patch panels, SFP, fibre patch cords, Cat6 I/O, face plates, gang boxes, patch cords 1 m + 2 m, Cat6 rolls = metres/305, misc, HDPE pipe) → **Services Phase 1** (fibre laying, conduit laying, rack install, splicing per core, I/O punching, switch config) → 18 % GST → **Wi-Fi & Firewall** + services → **CCTV** + services → **Additional installation items** (PVC conduit 25/32/40/50 mm, bends, couplers, saddles, junction boxes, IP65 boxes, ties/labels, GI pipe) with `=MAX(0, Full − already-supplied)`. |
| **IPBAX and Access Control** | Same column pattern, two vendor price columns side by side (Gyan Telecom vs Fastech) → **vendor comparison already exists in practice**. |

Derivation rules visible in the BOQ (these become the automatic logic):
- Cat6 I/O = **2 × points** (618 = 2 × 309: user end + panel end).
- Gang boxes = points (309); patch cords 1 m (panel side) = points, 2 m (user side) = points.
- Cat6 rolls = ⌈cable metres / 305⌉, per zone.
- Switches/patch panels = ⌈points per rack / 24⌉.
- SFP = 2 per fibre link; fibre patch cords = SFP count; splicing = cores × LIUs.
- Every material line has a matching service line (install / configure / test).

### Problems found in the reference sheets (the portal should prevent these)

1. **Budget sheet uses 260 points; the matrix totals 309.** The two were never linked, so the budget is ~16 % short.
2. **GST counted twice for CCTV** in Budget: dome/bullet rates already include 18 % (`=4000+4000*18%`), then 18 % is applied again on the grand total.
3. **Totals ranges are inconsistent**: `D53` sums rows 4–52, most other columns stop at row 49; `I53` is typed as `3` because the column holds text ("1-Finger Print Machine").
4. Rows 51–52 have floor **"?"**; text in numeric cells (`9Ux3`, `9U+42U`) breaks sums.
5. `boq -pujaso` `L76` sums `L68:L74` (misses row 75); IPBAX sheet has `#REF!` in `L15:L17`; phase quantities hard-typed in places (`H19`, `H23`, `G79`) so Phase 2 doesn’t equal Full − Phase 1.
6. CCTV installs 96 but camera accessory boxes 94.
7. No switch/port/patch-panel/VLAN/cable-ID columns at all — the current "port matrix" is a quantity sheet, not a port-level matrix.

**Implication:** the portal keeps this terminology and the location × point-type summary view, but adds a real **port-level** matrix underneath it, and generates both from one data source (the drawing).

---

## 1. Software Requirement Specification (condensed)

**Purpose.** Let an IT manager go from building layout → placed equipment → port matrix → BOQ → rough budget, with every number traceable to a symbol on a drawing.

**Users.** Admin (catalogue, rates, rules) · Planner (projects, drawings, BOQ) · Viewer (read & export).

**In scope.** Projects with buildings/floors/layouts; drawing editor; equipment catalogue; automatic quantities; port allocation & validation; BOQ; budget; Excel/PDF exports; Excel BOQ import & compare.

**Out of scope.** Network simulation, live device management/monitoring, purchase orders, accounting, vendor portal.

**Key functional requirements.**
- FR-1 Project CRUD with fields from brief §2; buildings → floors → layouts (many per floor).
- FR-2 Upload PDF/JPG/PNG/DWG/DXF; each layout has a calibrated scale (two-point "this line = N metres").
- FR-3 Drag-drop catalogue symbols; move/rotate/duplicate/delete; properties panel; layers; undo/redo; autosave.
- FR-4 Each placed item gets an ID `BLD-FLR-TYPE-###` (e.g. `B1-GF-CAM-014`), never reused.
- FR-5 Cable routes as polylines; length = drawn length × scale + vertical drop + service loop (configurable).
- FR-6 Quantities derived live from placements; manual override stored separately and flagged.
- FR-7 Port allocation by rules; manual edit; validation list (brief §5).
- FR-8 BOQ generated from quantities + derivation rules + catalogue; manual rows allowed.
- FR-9 Budget roll-ups by category, building, floor, phase; contingency; GST once.
- FR-10 Exports: port matrix (xlsx), BOQ (xlsx, pujaso layout), budget (xlsx/pdf), drawings (pdf).
- FR-11 Import an existing BOQ xlsx, map columns, diff against calculated.

**Non-functional.** Works on a laptop browser; a 300-point floor plan stays smooth (≤ 2,000 objects/layout); all calculations deterministic and reproducible; audit trail of manual overrides; INR default, multi-currency not needed.

---

## 2. Functional Module Breakdown

| # | Module | Responsibility | Depends on |
|---|---|---|---|
| M1 | Projects | Project / building / floor / phase / status | — |
| M2 | Drawing Manager | Upload, convert to raster/vector tiles, scale calibration, versions | M1 |
| M3 | Equipment Catalogue | Categories, makes, models, rates, specs, derived accessories | — |
| M4 | Layout Editor | Placement, routes, annotations, layers, undo/redo | M2, M3 |
| M5 | AI Suggest | Room detection + placement proposals (user approves) | M2, M4 |
| M6 | Quantity Engine | Placements + routes → quantities, overrides | M4 |
| M7 | Port Matrix | Rack/switch/patch-panel allocation, VLAN, validation | M6 |
| M8 | BOQ | Material + service lines, accessories, manual rows, import/compare | M6, M7, M3 |
| M9 | Budget | Roll-ups, contingency, GST, indicative vs vendor | M8 |
| M10 | Reports | PDF drawings, schedules, summaries, xlsx | all |
| M11 | Settings | Rules (ports per switch, spare %, roll length, loops, GST, VLAN map), users | — |

---

## 3. UI/UX Wireframes

**Navigation:** Dashboard · Projects · Drawing Manager · Equipment Library · Port Matrix · BOQ · IT Budget · Reports · Settings.

**Layout editor (main screen)**
```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Chhata Plant ▾  Building: Admin ▾  Floor: FF ▾   Layout: FF-Admin-v3 ▾  [Save][Export]│
├───────────────┬──────────────────────────────────────────────┬───────────────┤
│ LIBRARY       │  ⟲ ⟳  ✥ pan  🔍+ −  ⟂ scale  ✎ route  T note  │ PROPERTIES     │
│ 🔎 search     │                                              │ ID  B1-FF-AP-03│
│ ▸ Networking  │       [ architectural drawing ]              │ Type Indoor AP │
│ ▸ Cabling     │     ◉AP      ▣LAN×2     ◐CAM                 │ Model IAP515 ▾ │
│ ▸ Wireless    │        ╲___ cat6 route ___╱                  │ Room Reception │
│ ▸ CCTV        │                [Rack R2]                     │ Rack  R2  ▾    │
│ ▸ Telephony   │                                              │ VLAN  20       │
│ ▸ Other IT    │                                              │ Phase 1 ▾      │
│               │                                              │ Rotation 0°    │
├───────────────┤                                              ├───────────────┤
│ LAYERS  👁 🔒  │                                              │ FLOOR TOTALS   │
│ ☑ Network     │                                              │ LAN 46  AP 6   │
│ ☑ CCTV        │                                              │ CAM 12  Ph 48  │
│ ☐ Telephony   │                                              │ Cat6 1,896 m   │
└───────────────┴──────────────────────────────────────────────┴───────────────┘
```

**Port Matrix**
```
View: [Project][Building][Floor][Rack][Switch]   Summary ⇄ Port-level   ⚠ 4 issues  [Auto-allocate][Excel]
S# │Bldg │Floor│Room     │Equip ID     │Desc     │Type │Rack│Switch│Port│PP  │PP-Port│Cable ID   │Dest│VLAN│Remarks
1  │Admin│FF   │Cabin D1 │B1-FF-LAN-021│Data     │Cat6 │R2  │SW2-1 │07  │PP2-1│07    │R2-PP1-07 │... │10  │
⚠ B1-FF-CAM-009 unassigned — switch SW2-2 full (24/24)   [Fix: add switch] [Move to R3]
```
The **Summary** toggle reproduces the existing `PORT MATIRX.xlsx` layout (location rows × point-type columns), so the current way of working is kept.

**BOQ** — grid in the pujaso layout: `S.No · Description · UOM · Full BOQ · Phase 1 · Phase 2 · Make · Unit Price · Phase 1 ₹ · Phase 2 ₹`, grouped Material / Services per section; cell badges: **calc** (grey), **edited** (amber), **vendor rate** (green), **indicative rate** (blue).

**Budget** — KPI tiles (Material, Installation, GST, Contingency, Total) + switchable table by Category / Building / Floor / Phase; bar chart by category.

---

## 4. Database Schema (PostgreSQL)

```
project(id, name, client, location, description, phase, status, created_by, created_at)
building(id, project_id, name, code)
floor(id, building_id, name, code, level, height_m)
layout(id, floor_id, name, file_key, file_type, page, scale_m_per_px, width, height, version, is_current)
room(id, layout_id, name, polygon jsonb)                         -- manual or AI-detected

catalogue_category(id, name, parent_id, layer)
catalogue_item(id, category_id, manufacturer, model, description, specs jsonb, uom,
               indicative_rate, gst_pct, warranty, datasheet_url, install_rate,
               symbol_svg, ports_required, ports_provided, poe_w, is_active)
vendor(id, name, contact)
vendor_rate(id, catalogue_item_id, vendor_id, rate, valid_from, quote_ref)
accessory_rule(id, parent_item_id|category_id, accessory_item_id, qty_expr)   -- e.g. "2", "ceil(n/24)"

placement(id, layout_id, equip_code UNIQUE, catalogue_item_id, room_id, x, y, rotation,
          layer, phase, props jsonb, source enum(manual,ai_accepted), deleted_at)
route(id, layout_id, kind enum(cat6,cat6a,fiber,tray,conduit,hdmi,rg6), points jsonb,
      length_m, vertical_m, from_placement_id, to_placement_id)
annotation(id, layout_id, kind, geom jsonb, text)

rack(id, project_id, floor_id, code, size_u, placement_id)
switch(id, rack_id, code, catalogue_item_id, port_count, sfp_count, poe_budget_w)
patch_panel(id, rack_id, code, port_count)
port_assignment(id, placement_id, point_index, switch_id, switch_port, patch_panel_id,
                pp_port, cable_id, destination, vlan, remarks, is_manual)
fiber_link(id, from_rack_id, to_rack_id, cores, route_id)

quantity(id, project_id, scope(building/floor), key, calc_value, override_value, reason)
boq_line(id, project_id, section, kind enum(material,service), catalogue_item_id NULL,
         description, specs, brand, model, uom, qty_calc, qty_override, phase1_qty,
         rate_source enum(indicative,vendor,manual), unit_rate, gst_pct, install_rate,
         remarks, is_manual, sort)
budget_setting(project_id, contingency_pct, gst_mode, rounding)
rule_setting(project_id NULL, key, value)    -- global default if project_id NULL
audit_log(id, user_id, entity, entity_id, field, old, new, at)
```

---

## 5. Technical Architecture

```
Browser (Next.js + TypeScript)
 ├─ Editor: Konva.js (react-konva) — layered canvas, 2k+ shapes, hit-testing
 ├─ PDF.js for PDF layouts; image tiles for raster
 ├─ AG Grid (community) for Port Matrix / BOQ grids
 └─ TanStack Query → REST
        │
FastAPI (Python)
 ├─ Projects/Catalogue/Layouts CRUD (SQLAlchemy + Alembic)
 ├─ Calc engine (pure Python, unit-tested): quantities → ports → BOQ → budget
 ├─ File service: DXF via ezdxf; DWG → DXF via ODA File Converter (free, CLI) ; render to SVG/PNG
 ├─ Exports: openpyxl (xlsx with formulas kept), WeasyPrint (PDF reports), PyMuPDF (drawing PDFs)
 ├─ AI suggest worker: Claude vision model on the rendered floor image + room polygons → JSON proposals
 └─ Background jobs: RQ/Celery + Redis (conversion, AI, exports)
        │
PostgreSQL  ·  Object storage (S3 / MinIO) for drawings & exports
```

**Why these choices.** Konva over Fabric: better performance with many objects and clean React bindings. FastAPI fits because the DWG/DXF, Excel and PDF tooling is strongest in Python. Calculations run on the server, so exports and screens always agree.
**Alternative for a faster MVP:** you already host Daftarbox as static pages. A **browser-only Phase 1** (IndexedDB, SheetJS, pdf.js, Konva, no DWG) could reuse that hosting, with the backend added at Phase 2. I recommend a proper backend from day one, because you need multi-user access and DWG support.

---

## 6. Equipment Catalogue Structure

Category tree (brief §3) → items. Each item carries what the engines need:

| Field | Example (Aruba 1930 24G PoE) | Used by |
|---|---|---|
| category / layer | Networking › Access switch / Network | editor, budget |
| manufacturer, model | Aruba, JL684B | BOQ |
| specs (json) | 24×1G PoE+, 4×SFP+, 370 W | BOQ spec column |
| uom | Nos. | BOQ |
| **ports_required** | 0 | port matrix |
| **ports_provided** | 24 copper, 4 SFP | port allocation |
| poe_w | 370 budget | validation |
| indicative_rate / vendor rates | ₹ x / Gyan ₹ y, Fastech ₹ z | budget, compare |
| gst_pct | 18 | budget |
| install_rate, service item | "POE Network Switch config" | BOQ services |
| accessory_rule | +1 patch panel per switch, +1 cable manager | BOQ |
| symbol_svg, datasheet | — | editor, reports |

Endpoint items declare `ports_required` and point type, e.g. Dome camera = 1 × CCTV/Cat6, Cabin = 1 data + 2 voice, Door controller = reader + exit switch + lock runs. That lets the existing matrix columns (Finger-print reader, Exit switch, Lock …) be generated automatically.

Seeded from the reference sheets: Commscope passive, Aruba switching/AP, CP Plus CCTV, WD HDD, Fortigate, Syntel/Matrix/Grandstream PBX and phones, Comm Rack/APW/Rittal racks, plus the installation-material list (conduits, bends, saddles, boxes).

---

## 7. Port Matrix Calculation Logic

1. **Collect points.** For every placement with `ports_required > 0`, emit `n` network points with type (Data, Printer, Voice, CCTV, Wi-Fi, AV, Access-control).
2. **Serving rack.** Use the user-set value if there is one. Otherwise pick the nearest rack on the same floor, measured along drawn routes when they exist and in a straight line otherwise. Warn if the run is over **90 m** (Cat6 permanent link limit).
3. **Group per rack** by VLAN/type (configurable: e.g. CCTV on its own switch).
4. **Switch sizing per rack:** `switches = ceil(points × (1 + spare%) / usable_ports)`; usable_ports = 24 (or 48) minus reserved uplinks. Check PoE: Σ poe_w of APs/cameras/phones ≤ switch budget.
5. **Patch panels:** `ceil(points / 24)` per rack. Fill panel ports 1..24 in room order, then map **PPn-k → SWn-k** one-to-one (the usual straight-through layout).
6. **IDs:** Cable ID = `{Rack}-{PP}-{Port}` (e.g. `R2-PP1-07`), and the same label goes on the faceplate. Voice ports on an IP PBX use the same scheme.
7. **Uplinks:** each field rack gets a fibre link to the core (server room). That gives 2 SFP per link, an LIU at each end sized to the core count, and one fibre patch cord per SFP.
8. **VLAN** from Settings map (Data 10, Voice 20, CCTV 30, Wi-Fi 40, Access 50 …), overridable.
9. **Validation:** duplicate switch-port or PP-port, unassigned points, switch over capacity, PP over capacity, PoE over budget, missing equipment ID or destination, link over 90 m, floor/room missing (the "?" rows).
10. **Views:** port-level (brief columns) plus the summary pivot that reproduces `PORT MATIRX.xlsx`.

Manual edits set `is_manual = true`. Re-running auto-allocate keeps them unless the user ticks **reset**.

---

## 8. BOQ Calculation Logic

For each quantity key the engine creates material lines, accessory lines and service lines, using the pujaso terminology:

| BOQ line | Formula |
|---|---|
| Cat6 I/O | 2 × copper points |
| Face plate dual / quad | per outlet: 1–2 ports → dual, 3–4 → quad |
| Gang box | outlets |
| Patch cord 1 m (panel end) / 2 m (user end) | copper points each |
| Cat6 cable (Mtrs.) | Σ route lengths + vertical + service loop (default 3 m) × (1 + wastage 10 %) |
| Cat6 rolls | ceil(metres / 305), per building/zone |
| Patch panel 24 port | from §7 |
| PoE switch | from §7 |
| SFP module | 2 × fibre links (+ core spares) |
| Fibre cable (Mtrs.) | Σ fibre routes × 1.1, armoured where route is outdoor |
| LIU 6/12/24 port | per rack by cores terminated |
| Fibre patch cord | = SFP |
| Splicing (Core) | cores × terminations |
| Racks 9U/12U/24U/42U | placed racks; U sized from switches + panels + managers + 30 % spare |
| PDU, cable manager | 1 per rack / 1 per 2 panels |
| CCTV cameras by model | placements |
| NVR | ceil(cameras / channels) |
| HDD | from settings: cameras × bitrate × days ÷ disk size |
| Camera accessory box | = cameras (fixes 94/96 mismatch) |
| Wi-Fi AP | placements |
| IP phone, IP PBX (SIP ext ≥ phones) | placements |
| Access control | readers, locks, exit switches, controllers per door |
| Conduit 25/32/40/50 mm, bends, couplers, saddles, junction boxes | rule per metre of route by bundle size (e.g. saddle every 0.6 m, bend every 8 m) |
| **Services** | fibre laying (m), conduit laying (m), Cat6 laying (m), rack install (nos.), splicing (core), I/O punching, testing & ferruling (points), switch/AP/NVR/firewall config (nos.), camera install (nos.) |

The **phase columns** follow pujaso: Full BOQ, then Phase 1 (the sum of placements tagged Phase 1), then Phase 2 = Full − Phase 1, always computed and never typed.
**Import & compare:** upload an existing xlsx, map its columns (with auto-guess from header names), match lines to catalogue items (fuzzy match, then user confirms) and show a diff: matched lines with Δqty, lines only in the import, and lines only in the calculated BOQ.

---

## 9. Budget Calculation Logic

```
line_material  = qty × unit_rate                      (rate source: vendor > manual > indicative)
line_install   = qty × install_rate (or separate service line)
line_gst       = (line_material + line_install) × gst_pct      ← applied ONCE, rates stored ex-GST
subtotal       = Σ material + Σ install
contingency    = subtotal × contingency_pct (default 10 %)
total          = subtotal + contingency + Σ gst
```
- Roll up by category, building, floor (via placement → layout → floor) and phase. Project-wide lines such as the core rack and firewall are tagged "Common".
- Every amount shows its **rate source**. The header shows *% of value on vendor quotes*, which tells the user how firm the estimate is.
- Recurring costs (ILL, broadband, printer rental, AMC) sit in a separate section and are **not** added to the capex total, as in the Budget sheet.
- Vendor comparison: put two or more vendor rate columns side by side, as in the IPBAX sheet, and pick the lowest or a chosen vendor for each line.

---

## 10. What is reliably automatable vs. needs the user

| Reliable (deterministic) | Assisted (suggest → approve) | User decides |
|---|---|---|
| Counting placed items; IDs; totals by floor/building/category | Room detection from PDF/DWG text & walls | Where equipment goes (final) |
| Patch panels, switches, SFP, patch cords, I/O, gang boxes, rolls | AP positions (≈1 per 150–250 m² indoor) | Brand / model choice |
| Port allocation & cable IDs, VLAN by type | Camera positions at entries/perimeter/corridors | Rack locations |
| Validation checks | Cable route paths (shortest along corridors) | Phasing |
| Cable length **from drawn routes** with scale | Rack placement per floor | Vendor rates |
| BOQ services lines, GST, contingency, roll-ups | Matching imported BOQ lines to catalogue | Anything not on the drawing (laptops, ILL, AMC) |
| Excel/PDF exports | | |

**Honest limits:** DWG files need conversion and will not always come out clean. Scanned PDFs have no wall geometry, so AI placement there is only a starting point. Cable lengths are only as good as the scale calibration and the routes drawn.

---

## 11. Development Roadmap

| Phase | Scope (brief §13) | Exit test |
|---|---|---|
| 0 | This spec approved; catalogue seed from the two workbooks | Sign-off |
| 1 Core | Projects, building/floor, multi-layout upload (PDF/PNG/JPG, DXF; DWG via converter), viewer, scale calibration, manual placement, layers, undo/redo, catalogue admin | Re-draw Chhata FF-Admin and get the same counts as the matrix rows |
| 2 Planning | Routes (Cat6/6A/fibre/tray/conduit), auto IDs, quantity engine + overrides, AI suggestions | Chhata totals = 309 points, cable metres within 10 % of BOQ |
| 3 Port Matrix | Racks, switches, PP mapping, VLAN, validation, summary + port-level views, xlsx export | Zero validation errors; export opens in Excel matching PORT MATIRX columns |
| 4 BOQ & Budget | BOQ generation (pujaso layout, phases), rates, services, GST once, contingency, budget views, PDF reports, BOQ import & compare | Import `boq -pujaso.xlsx` and get an explained diff |
| 5 Advanced | Better drawing recognition, Wi-Fi heatmap, CCTV field-of-view, vendor comparison, project versions | — |

---

## 12. Development Cost & Timeline Estimate

Assumes 1 full-stack lead + 1 frontend (canvas) dev + part-time QA. Indian market rates, roughly ₹1.2–1.8 lakh per dev-month blended.

| Phase | Effort (dev-weeks) | Calendar | Cost (₹ lakh, approx.) |
|---|---|---|---|
| 1 Core | 10–12 | 6 wks | 4–6 |
| 2 Planning + AI | 8–10 | 5 wks | 3.5–5 |
| 3 Port Matrix | 5–6 | 3 wks | 2–3 |
| 4 BOQ & Budget + reports | 6–8 | 4 wks | 2.5–4 |
| **MVP (1–4)** | **29–36** | **~4.5 months** | **₹12–18 lakh** |
| 5 Advanced | 10–14 | 2–3 months | 5–7 |

Running cost: a small VPS or AWS instance plus Postgres and storage at about ₹4–8k/month, plus AI usage of a few rupees per layout suggestion.
If I build it here with you as the reviewer, calendar time is much shorter. The figures above are for a conventional team, so you have a budget benchmark.

---

## Decisions (approved 2026-11-26)

- Hosting: **full stack** (Next.js + FastAPI + PostgreSQL), in this repo under `it-infra-planner/`.
- DWG: **ODA File Converter on the server** → DXF.
- Port matrix: **both** summary (PORT MATIRX layout) and port-level views.
- Defaults: 20 % spare ports, 10 % cable wastage, 10 % contingency, rates stored ex-GST.

### Original open questions

1. **Hosting.** A full stack with a backend (recommended), or browser-only inside Daftarbox for an early MVP?
2. **DWG.** Is it OK to use ODA File Converter (free, needs a server), or will you export DXF/PDF from AutoCAD?
3. **Port-level matrix.** Is the new port-level matrix with switch/PP/cable ID/VLAN wanted, alongside the existing location × type summary?
4. **Defaults.** Spare ports 20 %? Wastage 10 %? Contingency 10 %? Are all rates stored ex-GST?
