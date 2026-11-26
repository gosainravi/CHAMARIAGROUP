# IT Infra Planner — Phase 1

Layout → equipment placement → (Phase 3) port matrix → (Phase 4) BOQ & budget.
Spec: [../docs/it-infra-planner-spec.md](../docs/it-infra-planner-spec.md)

## Run locally

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

## Phase 1 scope (done)
- Projects with client, location, description, buildings, floors, phase, status; buildings/floors auto-created and editable (codes feed equipment IDs).
- Layout upload per floor: PDF (one layout per page), JPG, PNG, DXF (rendered with ezdxf). DWG uses the free
  ODA File Converter if installed (or `ODA_CONVERTER` env var); otherwise the upload says to export DXF/PDF.
- Editor (Konva): drag-drop or click-to-place from the library, move, multi-select, delete, duplicate, rotate,
  change type/model/room/phase/points/remarks, text annotations, layers (show/lock, saved), zoom/pan/fit,
  undo/redo, save, scale calibration, PNG export, per-layout totals.
- Equipment IDs `B1-GF-CAM-001`, unique per project and never reused after delete.
- Equipment catalogue (33 categories, 43 models seeded from the Chhata workbooks) with indicative vs vendor rate,
  GST, install rate, warranty, datasheet; add/edit/delete (items in use are hidden, not deleted).

Not yet: cable routes & AI suggestions (Phase 2), port matrix (3), BOQ/budget/reports (4), users/login.
