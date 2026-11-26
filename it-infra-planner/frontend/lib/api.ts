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
  point_type: string; ports_required: number; items: Item[];
};
export type PlacementT = {
  id?: number; key: string; equip_code?: string; catalogue_item_id: number; x: number; y: number;
  rotation: number; room: string; phase: string; ports: number; remarks: string; source: string;
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
