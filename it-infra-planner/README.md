# IT Infra Planner — Phase 1

Layout → equipment placement → (Phase 3) port matrix → (Phase 4) BOQ & budget.
Spec: [../docs/it-infra-planner-spec.md](../docs/it-infra-planner-spec.md)

## Everyday use on this PC

Double-click **Start IT Infra Planner** (desktop shortcut, or `Start IT Infra Planner.bat` here). It starts Docker,
the database, the API and the web app, rebuilds the web app only when the code changed, and opens
http://localhost:3000. **Stop IT Infra Planner** shuts it down; projects stay in the database. Logs go to `logs/`.

## Run locally (development)

```powershell
# 1. Database (Docker Desktop must be running)
docker compose up -d                      # Postgres on localhost:5433

# 2. API  → http://localhost:8000/docs
cd backend
python -m venv .venv; .venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python -m uvicorn app.main:app --port 8000

# 3. Web  → http://localhost:3000
cd ..\frontend
npm install; npm run dev
```

Tables and the equipment catalogue are created and seeded automatically on first API start.
Tests: `cd backend; .venv\Scripts\python -m pytest -q` (needs the database running).

## What is built

**Phase 1 – Core:** projects → buildings → floors → layouts (PDF/JPG/PNG/DXF, DWG via ODA converter); editor with
drag-drop placement, move/rotate/duplicate/delete, layers, annotations, undo/redo, scale calibration; equipment IDs
(`B1-GF-CAM-001`, never reused); equipment catalogue with indicative vs vendor rates.

**Phase 2 – Planning:** cable routes in the editor (Cat6, Cat6A, fibre, tray, conduit) with lengths from the scale;
Wi-Fi/CCTV coverage overlay; suggestions (Claude vision when `ANTHROPIC_API_KEY` is set on the API, otherwise a
rule-based Wi-Fi grid) that the user accepts or rejects; live quantity engine with manual overrides (shown as adjusted).

**Phase 3 – Port Matrix:** points auto-assigned to the nearest rack (or a chosen rack), switches/patch panels sized
per rack with spare %, 1:1 PP→switch mapping, cable IDs, VLAN by point type; manual edits per cell; validation
(duplicate ports, capacity, unassigned, missing ID/room/destination, >90 m runs, PoE budget); views: summary
(PORT MATIRX layout), project, building, floor, rack, switch; Excel export.

**Phase 4 – BOQ & Budget:** BOQ generated from placements + port matrix (materials, accessories, services) in the
boq-pujaso layout (Full / Phase 1 / Phase 2 with live formulas); edit any cell, hide lines, add manual items;
import an existing Excel BOQ and compare; budget by category / building / floor / phase with GST once and
contingency; deliverables: layout PDFs (final + routing), schedule, port matrix and BOQ Excel, printable report.

**Phase 5 – Advanced:** predicted 5 GHz Wi-Fi heatmap (open-space log-distance model, walls not modelled);
Wi-Fi/CCTV coverage overlay; room names read from PDF text layers (shown on the drawing, auto-filled on new
equipment, "fill empty rooms" button — scanned PDFs, images and DXF have no readable text); vendor quotes per model
with a per-project comparison and "use cheapest / use vendor" rates; project versions with compare and restore
(restore first saves the current state).

Calculation rules (spare %, wastage, VLANs, CCTV storage, contingency …) are per project under **Settings**.
