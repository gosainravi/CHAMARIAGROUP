export const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export type LayoutSummary = {
  id: number; name: string; file_type: string; original_name: string;
  width: number; height: number; scale_m_per_px: number | null; placements: number; updated_at: string;
};
export type FloorT = { id: number; name: string; code: string; level: number; layouts: LayoutSummary[] };
export type BuildingT = { id: number; name: string; code: string; floors: FloorT[] };
export type Project = {
  id: number; name: string; client: string; location: string; description: string;
  num_buildings: number; num_floors: number; phase: string; status: string; created_at: string;
  layout_count?: number; placement_count?: number; buildings?: BuildingT[];
};
export type Item = {
  id: number; category_id: number; manufacturer: string; model: string; description: string; specs: string;
  uom: string; indicative_rate: number; vendor_rate: number | null; gst_pct: number; warranty: string;
  datasheet_url: string; install_rate: number; is_active: boolean;
};
export type Category = {
  id: number; group: string; name: string; layer: string; symbol: string; color: string;
  point_type: string; ports_required: number; placeable: boolean; items: Item[];
};
export type PlacementT = {
  id?: number; key: string; equip_code?: string; catalogue_item_id: number; x: number; y: number;
  rotation: number; room: string; phase: string; ports: number; remarks: string; source: string; serving_rack_id?: number | null;
};
export type AnnotationT = { key: string; x: number; y: number; text: string };
export type LayoutFull = LayoutSummary & {
  layers: Record<string, { visible: boolean; locked: boolean }>;
  floor: { id: number; name: string; code: string };
  building: { id: number; name: string; code: string };
  project: { id: number; name: string };
  placements: Omit<PlacementT, "key">[];
  annotations: Omit<AnnotationT, "key">[];
};

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(API + path, init);
  if (!r.ok) {
    let msg = r.statusText;
    try { const j = await r.json(); msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail); } catch {}
    throw new Error(msg || `Request failed (${r.status})`);
  }
  return r.status === 204 ? (undefined as T) : r.json();
}
const json = (method: string, body: unknown): RequestInit => ({
  method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

export const api = {
  projects: () => req<Project[]>("/api/projects"),
  project: (id: number) => req<Project>(`/api/projects/${id}`),
  createProject: (b: Partial<Project>) => req<Project>("/api/projects", json("POST", b)),
  patchProject: (id: number, b: Partial<Project>) => req<Project>(`/api/projects/${id}`, json("PATCH", b)),
  deleteProject: (id: number) => req<void>(`/api/projects/${id}`, { method: "DELETE" }),
  addBuilding: (pid: number, name: string, code?: string) => req<Project>(`/api/projects/${pid}/buildings`, json("POST", { name, code })),
  patchBuilding: (id: number, name: string, code?: string) => req<Project>(`/api/buildings/${id}`, json("PATCH", { name, code })),
  deleteBuilding: (id: number) => req<Project>(`/api/buildings/${id}`, { method: "DELETE" }),
  addFloor: (bid: number, name: string, code?: string) => req<Project>(`/api/buildings/${bid}/floors`, json("POST", { name, code })),
  patchFloor: (id: number, name: string, code?: string) => req<Project>(`/api/floors/${id}`, json("PATCH", { name, code })),
  deleteFloor: (id: number) => req<Project>(`/api/floors/${id}`, { method: "DELETE" }),
  upload: (fid: number, file: File, name: string) => {
    const fd = new FormData(); fd.append("file", file); fd.append("name", name);
    return req<{ created: LayoutSummary[]; project: Project }>(`/api/floors/${fid}/layouts`, { method: "POST", body: fd });
  },
  layout: (id: number) => req<LayoutFull>(`/api/layouts/${id}`),
  patchLayout: (id: number, b: Partial<LayoutFull>) => req<LayoutFull>(`/api/layouts/${id}`, json("PATCH", b)),
  deleteLayout: (id: number) => req<void>(`/api/layouts/${id}`, { method: "DELETE" }),
  saveContent: (id: number, placements: PlacementT[], annotations: AnnotationT[]) =>
    req<LayoutFull>(`/api/layouts/${id}/content`, json("PUT", {
      placements: placements.map(({ key: _k, equip_code: _c, ...p }) => p),
      annotations: annotations.map(({ key: _k, ...a }) => a),
    })),
  catalogue: () => req<Category[]>("/api/catalogue"),
  addItem: (b: Partial<Item>) => req<Item>("/api/catalogue/items", json("POST", b)),
  patchItem: (id: number, b: Partial<Item>) => req<Item>(`/api/catalogue/items/${id}`, json("PATCH", b)),
  deleteItem: (id: number) => req<{ deleted: boolean; deactivated?: boolean; used_by?: number }>(`/api/catalogue/items/${id}`, { method: "DELETE" }),
  imageUrl: (id: number) => `${API}/api/layouts/${id}/image`,
};

export const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

// ---------------- Phase 2-4 ----------------
export type RouteT = { key: string; id?: number; kind: RouteKind; points: number[]; vertical_m: number; label: string; length_m?: number | null };
export type RouteKind = "cat6" | "cat6a" | "fiber" | "tray" | "conduit";
export const ROUTE_KINDS: { kind: RouteKind; label: string; color: string }[] = [
  { kind: "cat6", label: "Cat6", color: "#2563eb" }, { kind: "cat6a", label: "Cat6A", color: "#7c3aed" },
  { kind: "fiber", label: "Fibre", color: "#ea580c" }, { kind: "tray", label: "Cable tray", color: "#a16207" },
  { kind: "conduit", label: "Conduit", color: "#64748b" },
];
export type Suggestion = { symbol: string; x: number; y: number; room: string; reason: string; source: string; catalogue_item_id: number; ports: number };
export type Qty = { key: string; label: string; unit: string; calc: number; override: number | null; value: number; group: string; basis: string; reason: string };
export type PmRow = {
  sn: number; placement_id: number; point_index: number; building: string; bcode: string; floor: string; fcode: string; room: string;
  equip_code: string; description: string; point_type: string; cable: string; rack_id: number | null; rack: string;
  switch: string; switch_no: number | null; switch_port: number | null; patch_panel: string; pp_no: number | null; pp_port: number | null;
  cable_id: string; destination: string; vlan: number | string; remarks: string; length_m: number; phase: string; overridden: string[];
};
export type Issue = { level: "error" | "warning"; code: string; message: string; placement_id: number | null; point_index: number | null };
export type RackT = { id: number; code: string; model: string; building: string; floor: string; points: number; switches: number; patch_panels: number; phase: string };
export type PortMatrix = {
  rows: PmRow[]; racks: RackT[]; issues: Issue[]; core_rack: string | null; settings: { switch_ports: number; pp_ports: number; spare_pct: number };
  summary: { types: string[]; rows: (Record<string, number | string>)[]; totals: Record<string, number> };
};
export type BoqLineT = {
  key: string; sn: number; section: string; kind: string; description: string; specs: string; brand: string; model: string; uom: string;
  qty: number; phase1: number; phase2: number; rate: number; rate_source: "vendor" | "indicative" | "manual" | "missing"; gst_pct: number;
  install_rate: number; remarks: string; material: number; install: number; gst: number; total: number;
  calc_qty: number | null; edited: string[]; manual?: boolean;
};
export type BudgetRow = { key: string; label: string; material: number; install: number; gst: number; contingency: number; total: number };
export type Budget = {
  material: number; install: number; gst: number; contingency_pct: number; contingency: number; total: number;
  pct_vendor: number; pct_manual: number; missing_rates: string[];
  by_section: BudgetRow[]; by_phase: BudgetRow[]; by_floor: BudgetRow[]; by_building: BudgetRow[];
};
export type Boq = { lines: BoqLineT[]; sections: string[]; budget: Budget; issues: number };
export type CompareRow = { status: "matched" | "only_imported" | "only_calculated"; score?: number; imported?: { sheet: string; description: string; qty: number; uom: string };
  calc_key?: string; calc_description?: string; calc_qty?: number; delta?: number };

export const api2 = {
  routes: (lid: number) => req<Omit<RouteT, "key">[]>(`/api/layouts/${lid}/routes`),
  saveRoutes: (lid: number, routes: RouteT[]) => req<Omit<RouteT, "key">[]>(`/api/layouts/${lid}/routes`,
    json("PUT", routes.map(({ kind, points, vertical_m, label }) => ({ kind, points, vertical_m, label })))),
  suggest: (lid: number, mode: string, focus: string) => req<{ suggestions: Suggestion[]; note: string; engine: string }>(`/api/layouts/${lid}/suggest`, json("POST", { mode, focus })),
  quantities: (pid: number) => req<{ quantities: Qty[]; issues: number }>(`/api/projects/${pid}/quantities`),
  overrideQty: (pid: number, key: string, value: number | null, reason = "") => req<{ quantities: Qty[]; issues: number }>(`/api/projects/${pid}/quantities/${key}`, json("PUT", { value, reason })),
  portMatrix: (pid: number) => req<PortMatrix>(`/api/projects/${pid}/port-matrix`),
  editPort: (pid: number, placement_id: number, point_index: number, data: Record<string, unknown>) =>
    req<PortMatrix>(`/api/projects/${pid}/port-matrix`, json("PUT", { placement_id, point_index, data })),
  resetPorts: (pid: number) => req<PortMatrix>(`/api/projects/${pid}/port-matrix/reset`, { method: "POST" }),
  boq: (pid: number) => req<Boq>(`/api/projects/${pid}/boq`),
  editBoq: (pid: number, key: string, data: Record<string, unknown>) => req<Boq>(`/api/projects/${pid}/boq/${encodeURIComponent(key)}`, json("PUT", { data })),
  addBoq: (pid: number, data: Record<string, unknown>) => req<Boq>(`/api/projects/${pid}/boq`, json("POST", { data })),
  deleteBoq: (pid: number, key: string) => req<Boq>(`/api/projects/${pid}/boq/${encodeURIComponent(key)}`, { method: "DELETE" }),
  resetBoq: (pid: number) => req<Boq>(`/api/projects/${pid}/boq/reset`, { method: "POST" }),
  compareBoq: (pid: number, file: File) => { const fd = new FormData(); fd.append("file", file);
    return req<{ file: string; imported_rows: number; rows: CompareRow[] }>(`/api/projects/${pid}/boq/compare`, { method: "POST", body: fd }); },
  budget: (pid: number) => req<Budget>(`/api/projects/${pid}/budget`),
  settings: (pid: number) => req<{ values: Record<string, unknown>; defaults: Record<string, unknown>; racks: { id: number; code: string; model: string }[] }>(`/api/projects/${pid}/settings`),
  saveSettings: (pid: number, v: Record<string, unknown>) => req<{ values: Record<string, unknown>; defaults: Record<string, unknown>; racks: { id: number; code: string; model: string }[] }>(`/api/projects/${pid}/settings`, json("PUT", v)),
  report: (pid: number) => req<{
    project: Project; schedule: { equip_code: string; category: string; make: string; model: string; building: string; floor: string; room: string; phase: string; points: number }[];
    by_category: [string, number][]; by_building: Record<string, Record<string, number>>; budget: Budget; issues: Issue[];
    layouts: { id: number; name: string; floor: string; building: string }[]; points: Record<string, number>;
  }>(`/api/projects/${pid}/report`),
  file: (path: string) => `${API}${path}`,
};

export async function download(path: string) {
  const r = await fetch(API + path);
  if (!r.ok) { let m = r.statusText; try { m = (await r.json()).detail; } catch {} throw new Error(m); }
  const cd = r.headers.get("Content-Disposition") || "";
  const name = decodeURIComponent((/filename="?([^"]+)"?/.exec(cd)?.[1]) || path.split("/").pop() || "download");
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
