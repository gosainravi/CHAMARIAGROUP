"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Stage, Layer, Image as KImage, Group, Rect, Text, Line, Circle, Wedge } from "react-konva";
import type Konva from "konva";
import useImage from "use-image";
import { api, api2, AnnotationT, Category, Item, LayoutFull, PlacementT, Project, RouteT, RouteKind, ROUTE_KINDS, Suggestion, api3, RoomLabel } from "@/lib/api";

type Snap = { placements: PlacementT[]; annotations: AnnotationT[]; routes: RouteT[] };
type Tool = "select" | "pan" | "text" | "scale" | "route";
let seq = 0;
const newKey = () => `n${Date.now().toString(36)}${(seq++).toString(36)}`;
const PHASES = ["Phase 1", "Phase 2", "Phase 3"];

export default function Editor({ layoutId }: { layoutId: number }) {
  const router = useRouter();
  const [layout, setLayout] = useState<LayoutFull | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [cats, setCats] = useState<Category[]>([]);
  const [placements, setPlacements] = useState<PlacementT[]>([]);
  const [annotations, setAnnotations] = useState<AnnotationT[]>([]);
  const [past, setPast] = useState<Snap[]>([]);
  const [future, setFuture] = useState<Snap[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState<string[]>([]);
  const [tool, setTool] = useState<Tool>("select");
  const [armed, setArmed] = useState<number | null>(null); // catalogue item id for click-to-place
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [symScale, setSymScale] = useState(1);
  const [showIds, setShowIds] = useState(true);
  const [scalePts, setScalePts] = useState<{ x: number; y: number }[]>([]);
  const [space, setSpace] = useState(false);
  const [libQ, setLibQ] = useState("");
  const [routes, setRoutes] = useState<RouteT[]>([]);
  const [routeKind, setRouteKind] = useState<RouteKind>("cat6");
  const [drawPts, setDrawPts] = useState<number[]>([]);
  const [coverage, setCoverage] = useState(false);
  const [sugs, setSugs] = useState<(Suggestion & { key: string })[]>([]);
  const [sugBusy, setSugBusy] = useState(false);
  const [sugNote, setSugNote] = useState("");
  const [heatmap, setHeatmap] = useState(false);
  const [rooms, setRooms] = useState<RoomLabel[]>([]);
  const [showRooms, setShowRooms] = useState(false);
  const [roomNote, setRoomNote] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const stage = useRef<Konva.Stage>(null);
  const [img] = useImage(layout ? api.imageUrl(layout.id) : "", "anonymous");

  // ---------- load ----------
  useEffect(() => {
    let live = true;
    Promise.all([api.layout(layoutId), api.catalogue()]).then(([l, c]) => {
      if (!live) return;
      setLayout(l); setCats(c);
      setPlacements(l.placements.map((p) => ({ ...p, key: `s${p.id}` })));
      setAnnotations(l.annotations.map((a) => ({ ...a, key: newKey() })));
      setPast([]); setFuture([]); setDirty(false); setSel([]);
      api.project(l.project.id).then((p) => live && setProject(p));
      api2.routes(layoutId).then((r) => live && setRoutes(r.map((x) => ({ ...x, key: newKey() }))));
      api3.roomLabels(layoutId).then((r) => { if (live) { setRooms(r.labels); setRoomNote(r.note); } }).catch(() => {});
    }).catch((e) => setErr(e.message));
    return () => { live = false; };
  }, [layoutId]);

  const itemMap = useMemo(() => {
    const m = new Map<number, { item: Item; cat: Category }>();
    cats.forEach((c) => c.items.forEach((i) => m.set(i.id, { item: i, cat: c })));
    return m;
  }, [cats]);

  const base = layout ? Math.max(layout.width, layout.height) / 130 : 20; // symbol unit in image px
  const S = base * symScale;

  // ---------- canvas size + fit ----------
  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) => { if (e.contentRect.width > 0 && e.contentRect.height > 0) setSize({ w: e.contentRect.width, h: e.contentRect.height }); });
    ro.observe(box.current);
    return () => ro.disconnect();
  }, [layout]);
  const fit = useCallback(() => {
    if (!layout) return;
    const s = Math.min(size.w / layout.width, size.h / layout.height) * 0.95;
    setView({ scale: s, x: (size.w - layout.width * s) / 2, y: (size.h - layout.height * s) / 2 });
  }, [layout, size]);
  const fitted = useRef(false);
  useEffect(() => { if (layout && size.w > 100 && !fitted.current) { fitted.current = true; fit(); } }, [layout, size, fit]);
  useEffect(() => { fitted.current = false; }, [layoutId]);

  // ---------- history ----------
  const commit = useCallback((p: PlacementT[], a: AnnotationT[] = annotations, r: RouteT[] = routes) => {
    setPast((h) => [...h.slice(-199), { placements, annotations, routes }]);
    setFuture([]);
    setPlacements(p); setAnnotations(a); setRoutes(r); setDirty(true);
  }, [placements, annotations, routes]);
  const restore = (s: Snap) => { setPlacements(s.placements); setAnnotations(s.annotations); setRoutes(s.routes); setDirty(true); };
  const undo = useCallback(() => {
    if (!past.length) return;
    setFuture((f) => [{ placements, annotations, routes }, ...f]);
    const s = past[past.length - 1];
    setPast(past.slice(0, -1)); restore(s);
  }, [past, placements, annotations, routes]);
  const redo = useCallback(() => {
    if (!future.length) return;
    setPast((h) => [...h, { placements, annotations, routes }]);
    const s = future[0];
    setFuture(future.slice(1)); restore(s);
  }, [future, placements, annotations, routes]);

  // ---------- save ----------
  const save = useCallback(async () => {
    if (!layout || saving) return;
    setSaving(true); setErr("");
    try {
      const sentIds = new Set(placements.filter((p) => p.id).map((p) => p.id));
      const res = await api.saveContent(layout.id, placements, annotations);
      const savedRoutes = await api2.saveRoutes(layout.id, routes);
      setRoutes((cur) => cur.map((r, i) => ({ ...r, id: savedRoutes[i]?.id, length_m: savedRoutes[i]?.length_m })));
      const fresh = res.placements.filter((p) => !sentIds.has(p.id!)).sort((a, b) => a.id! - b.id!);
      const newKeys = placements.filter((p) => !p.id).map((p) => p.key);
      const keyToSaved = new Map<string, (typeof res.placements)[number]>();
      newKeys.forEach((k, i) => fresh[i] && keyToSaved.set(k, fresh[i]));
      const byId = new Map(res.placements.map((p) => [p.id, p]));
      const merge = (list: PlacementT[]) => list.map((p) => {
        const s = keyToSaved.get(p.key) || (p.id ? byId.get(p.id) : undefined);
        return s ? { ...p, id: s.id, equip_code: s.equip_code, ports: s.ports } : p;
      });
      setPlacements((cur) => merge(cur));
      setPast((h) => h.map((s) => ({ ...s, placements: merge(s.placements) })));
      setFuture((h) => h.map((s) => ({ ...s, placements: merge(s.placements) })));
      setLayout({ ...layout, ...res, placements: res.placements, annotations: res.annotations });
      setDirty(false);
    } catch (e) { setErr(`Save failed: ${(e as Error).message}`); }
    finally { setSaving(false); }
  }, [layout, placements, annotations, routes, saving]);

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); } };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  // ---------- layers ----------
  const layers = layout?.layers || {};
  const layerOf = (p: PlacementT) => itemMap.get(p.catalogue_item_id)?.cat.layer || "Other";
  const visible = (l: string) => layers[l]?.visible !== false;
  const locked = (l: string) => !!layers[l]?.locked;
  const setLayer = async (name: string, patch: Partial<{ visible: boolean; locked: boolean }>) => {
    if (!layout) return;
    const next = { ...layers, [name]: { ...{ visible: true, locked: false }, ...layers[name], ...patch } };
    setLayout({ ...layout, layers: next });
    if (patch.visible === false || patch.locked) setSel((s) => s.filter((k) => {
      const p = placements.find((x) => x.key === k); return p ? layerOf(p) !== name : name !== "Annotations";
    }));
    try { await api.patchLayout(layout.id, { layers: next }); } catch (e) { setErr((e as Error).message); }
  };
  const layerNames = useMemo(() => {
    const s = new Set(Object.keys(layers));
    cats.filter((c) => c.placeable !== false).forEach((c) => s.add(c.layer)); s.add("Routes"); s.add("Annotations");
    return Array.from(s);
  }, [layers, cats]);

  const nearestRoom = (x: number, y: number) => {
    if (!rooms.length || !layout) return "";
    const lim = layout.scale_m_per_px ? 12 / layout.scale_m_per_px : Math.max(layout.width, layout.height) * 0.08;
    let best = "", bd = lim;
    rooms.forEach((r) => { const d = Math.hypot(r.x - x, r.y - y); if (d < bd) { bd = d; best = r.text; } });
    return best;
  };
  const autofillRooms = () => {
    let n = 0;
    const next = placements.map((p) => { if (p.room) return p; const r = nearestRoom(p.x, p.y); if (r) n++; return r ? { ...p, room: r } : p; });
    if (n) commit(next);
    setRoomNote(n ? `Filled the room on ${n} item(s) from the nearest room name on the drawing — check them.` : "No empty rooms near a detected room name.");
  };

  // ---------- actions ----------
  const place = (itemId: number, x: number, y: number) => {
    const info = itemMap.get(itemId);
    if (!info || !layout) return;
    if (locked(info.cat.layer)) { setErr(`Layer ${info.cat.layer} is locked`); return; }
    const p: PlacementT = {
      key: newKey(), catalogue_item_id: itemId, x: clamp(x, 0, layout.width), y: clamp(y, 0, layout.height),
      rotation: 0, room: nearestRoom(x, y), phase: "Phase 1", ports: info.cat.ports_required, remarks: "", source: "manual",
    };
    if (!visible(info.cat.layer)) setLayer(info.cat.layer, { visible: true });
    commit([...placements, p]); setSel([p.key]);
  };
  const removeSel = () => {
    if (!sel.length) return;
    commit(placements.filter((p) => !sel.includes(p.key)), annotations.filter((a) => !sel.includes(a.key)), routes.filter((r) => !sel.includes(r.key)));
    setSel([]);
  };
  const duplicateSel = () => {
    const src = placements.filter((p) => sel.includes(p.key));
    if (!src.length) return;
    const copies = src.map((p) => ({ ...p, id: undefined, equip_code: undefined, key: newKey(), x: p.x + S * 1.5, y: p.y + S * 1.5 }));
    commit([...placements, ...copies]); setSel(copies.map((c) => c.key));
  };
  const update = (keys: string[], patch: Partial<PlacementT>) =>
    commit(placements.map((p) => (keys.includes(p.key) ? { ...p, ...patch } : p)));
  const rotateSel = (deg: number) =>
    commit(placements.map((p) => (sel.includes(p.key) ? { ...p, rotation: (((p.rotation + deg) % 360) + 360) % 360 } : p)));
  const nudge = (dx: number, dy: number) =>
    commit(placements.map((p) => (sel.includes(p.key) ? { ...p, x: p.x + dx, y: p.y + dy } : p)),
      annotations.map((a) => (sel.includes(a.key) ? { ...a, x: a.x + dx, y: a.y + dy } : a)));

  const finishRoute = (pts = drawPts) => {
    if (pts.length >= 4) {
      const r: RouteT = { key: newKey(), kind: routeKind, points: pts, vertical_m: 0, label: "" };
      if (!visible("Routes")) setLayer("Routes", { visible: true });
      commit(placements, annotations, [...routes, r]); setSel([r.key]);
    }
    setDrawPts([]);
  };
  const routeLen = (r: { points: number[]; vertical_m: number }) => {
    let px = 0;
    for (let i = 0; i + 3 < r.points.length; i += 2) px += Math.hypot(r.points[i + 2] - r.points[i], r.points[i + 3] - r.points[i + 1]);
    return layout?.scale_m_per_px ? px * layout.scale_m_per_px + (r.vertical_m || 0) : null;
  };
  const runSuggest = async (mode: string) => {
    if (!layout) return;
    setSugBusy(true); setSugNote("");
    try {
      const r = await api2.suggest(layout.id, mode, "");
      setSugs(r.suggestions.map((s) => ({ ...s, key: newKey() })));
      setSugNote(r.note || `${r.suggestions.length} suggestions from ${r.engine === "ai" ? "AI" : "rules"} — review, then accept or reject.`);
    } catch (e) { setSugNote((e as Error).message); }
    finally { setSugBusy(false); }
  };
  const acceptSugs = (keys: string[]) => {
    const add = sugs.filter((s) => keys.includes(s.key)).map((s): PlacementT => ({
      key: newKey(), catalogue_item_id: s.catalogue_item_id, x: s.x, y: s.y, rotation: 0, room: s.room, phase: "Phase 1",
      ports: s.ports, remarks: s.reason, source: "ai_accepted",
    }));
    if (add.length) commit([...placements, ...add]);
    setSugs(sugs.filter((s) => !keys.includes(s.key)));
  };

  // ---------- keyboard ----------
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT") return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (mod && (k === "y" || (k === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
      else if (mod && k === "s") { e.preventDefault(); save(); }
      else if (mod && k === "d") { e.preventDefault(); duplicateSel(); }
      else if (mod && k === "a") { e.preventDefault(); setSel(placements.filter((p) => visible(layerOf(p)) && !locked(layerOf(p))).map((p) => p.key)); }
      else if (k === "delete" || k === "backspace") { e.preventDefault(); removeSel(); }
      else if (k === "r" && sel.length) rotateSel(e.shiftKey ? -15 : 15);
      else if (k === "enter" && tool === "route") { e.preventDefault(); finishRoute(); }
      else if (k === "escape") { if (drawPts.length) { setDrawPts([]); return; } setSel([]); setArmed(null); setScalePts([]); setTool("select"); }
      else if (k === " ") { e.preventDefault(); setSpace(true); }
      else if (k.startsWith("arrow") && sel.length) {
        e.preventDefault();
        const d = (e.shiftKey ? 10 : 1) * (S / 10);
        nudge(k === "arrowleft" ? -d : k === "arrowright" ? d : 0, k === "arrowup" ? -d : k === "arrowdown" ? d : 0);
      }
    };
    const up = (e: KeyboardEvent) => { if (e.key === " ") setSpace(false); };
    window.addEventListener("keydown", h); window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", h); window.removeEventListener("keyup", up); };
  });

  // ---------- pointer ----------
  const pointer = () => stage.current?.getRelativePointerPosition() || { x: 0, y: 0 };
  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const st = stage.current!; const old = view.scale; const ptr = st.getPointerPosition()!;
    const ns = clamp(old * (e.evt.deltaY > 0 ? 1 / 1.15 : 1.15), 0.02, 20);
    const mx = (ptr.x - view.x) / old, my = (ptr.y - view.y) / old;
    setView({ scale: ns, x: ptr.x - mx * ns, y: ptr.y - my * ns });
  };
  const zoomBy = (f: number) => {
    const ns = clamp(view.scale * f, 0.02, 20);
    const cx = size.w / 2, cy = size.h / 2;
    setView({ scale: ns, x: cx - ((cx - view.x) / view.scale) * ns, y: cy - ((cy - view.y) / view.scale) * ns });
  };
  const onStageClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const onBg = e.target === e.target.getStage() || e.target.name() === "bg";
    const pos = pointer();
    if (tool === "scale") {
      const pts = [...scalePts, pos];
      if (pts.length < 2) { setScalePts(pts); return; }
      const px = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      setScalePts(pts);
      setTimeout(async () => {
        const v = prompt(`That line is ${px.toFixed(0)} px on the drawing. How many metres is it in reality?`);
        setScalePts([]); setTool("select");
        const m = Number(v);
        if (!v || !(m > 0) || px < 1) return;
        try { setLayout(await api.patchLayout(layout!.id, { scale_m_per_px: m / px }).then((l) => ({ ...layout!, scale_m_per_px: l.scale_m_per_px }))); }
        catch (x) { setErr((x as Error).message); }
      }, 10);
      return;
    }
    if (tool === "route") {
      setDrawPts([...drawPts, Math.round(pos.x), Math.round(pos.y)]);
      return;
    }
    if (tool === "text" && onBg) {
      const text = prompt("Annotation text"); if (!text?.trim()) return;
      if (!visible("Annotations")) setLayer("Annotations", { visible: true });
      const a = { key: newKey(), x: pos.x, y: pos.y, text };
      commit(placements, [...annotations, a]); setSel([a.key]); setTool("select");
      return;
    }
    if (armed && onBg) { place(armed, pos.x, pos.y); return; }
    if (onBg) setSel([]);
  };
  const pick = (key: string, e: Konva.KonvaEventObject<Event>) => {
    e.cancelBubble = true;
    const shift = (e.evt as MouseEvent).shiftKey || (e.evt as MouseEvent).ctrlKey;
    setSel((s) => (shift ? (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]) : s.includes(key) ? s : [key]));
  };

  // ---------- derived ----------
  const totals = useMemo(() => {
    const byCat = new Map<number, { cat: Category; n: number }>();
    const byPoint = new Map<string, number>();
    placements.forEach((p) => {
      const i = itemMap.get(p.catalogue_item_id); if (!i) return;
      const t = byCat.get(i.cat.id) || { cat: i.cat, n: 0 }; t.n++; byCat.set(i.cat.id, t);
      if (i.cat.point_type && p.ports) byPoint.set(i.cat.point_type, (byPoint.get(i.cat.point_type) || 0) + p.ports);
    });
    return { byCat: Array.from(byCat.values()).sort((a, b) => a.cat.id - b.cat.id), byPoint: Array.from(byPoint.entries()) };
  }, [placements, itemMap]);
  const heatCanvas = useMemo(() => {
    if (!heatmap || !layout?.scale_m_per_px) return null;
    const aps = placements.filter((p) => { const c = itemMap.get(p.catalogue_item_id)?.cat; return c?.point_type === "Wi-Fi" && visible(c.layer); });
    if (!aps.length) return null;
    const cols = 220, cell = layout.width / cols, rows = Math.ceil(layout.height / cell);
    const cv = document.createElement("canvas"); cv.width = cols; cv.height = rows;
    const ctx = cv.getContext("2d")!; const im = ctx.createImageData(cols, rows);
    const sc = layout.scale_m_per_px;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const x = (i + 0.5) * cell, y = (j + 0.5) * cell;
      let best = -200;
      for (const a of aps) {
        const d = Math.max(1, Math.hypot(a.x - x, a.y - y) * sc);
        const outdoor = itemMap.get(a.catalogue_item_id)?.cat.symbol === "OAP";
        const rssi = (outdoor ? -32 : -38) - 10 * (outdoor ? 2.4 : 3.0) * Math.log10(d); // 5 GHz log-distance model
        if (rssi > best) best = rssi;
      }
      const k = (j * cols + i) * 4;
      const [r, g, b, a] = best >= -60 ? [22, 163, 74, 150] : best >= -67 ? [132, 204, 22, 130] : best >= -72 ? [234, 179, 8, 120] : best >= -78 ? [234, 88, 12, 110] : [0, 0, 0, 0];
      im.data[k] = r; im.data[k + 1] = g; im.data[k + 2] = b; im.data[k + 3] = a;
    }
    ctx.putImageData(im, 0, 0);
    return cv;
  }, [heatmap, layout?.scale_m_per_px, layout?.width, layout?.height, placements, itemMap]); // eslint-disable-line react-hooks/exhaustive-deps
  const selP = placements.filter((p) => sel.includes(p.key));
  const selA = annotations.filter((a) => sel.includes(a.key));
  const siblings = (project?.buildings || []).flatMap((b) => b.floors.flatMap((f) => f.layouts.map((l) => ({ b, f, l }))));

  if (err && !layout) return <div className="main"><div className="error">{err}</div><Link href="/projects">Back to projects</Link></div>;
  if (!layout) return <div className="main muted">Loading layout…</div>;

  const draggable = tool === "pan" || space;
  const cursor = draggable ? "grab" : tool === "scale" || tool === "route" || armed ? "crosshair" : tool === "text" ? "text" : "default";
  const selR = routes.filter((r) => sel.includes(r.key));
  const racksHere = placements.filter((p) => p.id && itemMap.get(p.catalogue_item_id)?.cat.symbol === "RK");
  const scale = layout.scale_m_per_px;

  return (
    <div className="ed">
      <div className="ed-top">
        <Link href={`/projects/${layout.project.id}`} title="Back to project">← {layout.project.name}</Link>
        <select value={layout.id} onChange={(e) => {
          if (dirty && !confirm("You have unsaved changes on this layout. Leave without saving?")) return;
          router.push(`/editor/${e.target.value}`);
        }}>
          {siblings.length ? siblings.map(({ b, f, l }) => <option key={l.id} value={l.id}>{b.code} · {f.name} · {l.name}</option>)
            : <option value={layout.id}>{layout.building.code} · {layout.floor.name} · {layout.name}</option>}
        </select>
        <span className="code">{layout.building.code}-{layout.floor.code}</span>
        <span style={{ flex: 1 }} />
        {err && <span className="error" style={{ margin: 0, padding: "3px 8px" }} onClick={() => setErr("")}>{err}</span>}
        <span className="small muted">{layout.scale_m_per_px ? `Scale 1 m = ${(1 / layout.scale_m_per_px).toFixed(1)} px` : <span className="badge warn">Scale not set</span>}</span>
        {dirty ? <span className="dirty">● Unsaved</span> : <span className="small muted">Saved</span>}
        <button onClick={undo} disabled={!past.length} title="Undo (Ctrl+Z)">Undo</button>
        <button onClick={redo} disabled={!future.length} title="Redo (Ctrl+Y)">Redo</button>
        <button className="primary" onClick={save} disabled={saving || !dirty} title="Save (Ctrl+S)">{saving ? "Saving…" : "Save"}</button>
        <a className="btn" href={`${api.imageUrl(layout.id).replace("/image", "/original")}`}>Original</a>
        <button onClick={() => {
          const st = stage.current; if (!st) return;
          const old = { ...view };
          st.scale({ x: 1, y: 1 }); st.position({ x: 0, y: 0 });
          const url = st.toDataURL({ x: 0, y: 0, width: layout.width, height: layout.height, pixelRatio: 1 });
          st.scale({ x: old.scale, y: old.scale }); st.position({ x: old.x, y: old.y });
          const a = document.createElement("a"); a.href = url; a.download = `${layout.building.code}-${layout.floor.code}-${layout.name}.png`; a.click();
        }} title="Download the layout with equipment as PNG">Export PNG</button>
      </div>

      <div className="ed-body">
        {/* library */}
        <aside className="ed-left">
          <h3>Equipment library</h3>
          <input placeholder="Search" value={libQ} onChange={(e) => setLibQ(e.target.value)} style={{ marginBottom: 8 }} />
          <div className="muted small" style={{ marginBottom: 8 }}>Drag onto the drawing, or click a model then click the drawing to place several. Esc stops.</div>
          {Array.from(new Set(cats.filter((c) => c.placeable !== false).map((c) => c.group))).map((g) => (
            <details className="lib-group" key={g} open>
              <summary>{g}</summary>
              {cats.filter((c) => c.group === g).flatMap((c) => c.items.filter((i) => i.is_active).map((i) => ({ c, i })))
                .filter(({ c, i }) => !libQ || `${c.name} ${i.manufacturer} ${i.model}`.toLowerCase().includes(libQ.toLowerCase()))
                .map(({ c, i }) => (
                  <div key={i.id} className="lib-item" draggable title={i.description}
                    style={armed === i.id ? { background: "var(--accent-weak)", outline: "1px solid var(--accent)" } : undefined}
                    onDragStart={(e) => { e.dataTransfer.setData("text/item", String(i.id)); e.dataTransfer.effectAllowed = "copy"; }}
                    onClick={() => { setArmed(armed === i.id ? null : i.id); setTool("select"); }}>
                    <span className="sym" style={{ background: c.color }}>{c.symbol}</span>
                    <div style={{ minWidth: 0 }}>
                      <div>{c.name}</div>
                      <div className="muted small" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{i.manufacturer} {i.model}</div>
                    </div>
                  </div>
                ))}
            </details>
          ))}
        </aside>

        {/* canvas */}
        <div className="ed-canvas" ref={box} style={{ cursor }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const id = Number(e.dataTransfer.getData("text/item")); if (!id || !stage.current) return;
            stage.current.setPointersPositions(e);
            const p = pointer(); place(id, p.x, p.y);
          }}>
          <div className="ed-tools">
            {(["select", "pan", "text", "scale"] as const).map((t) => (
              <button key={t} className={tool === t ? "on" : ""} onClick={() => { setTool(t); setArmed(null); setScalePts([]); }}
                title={{ select: "Select & move (Esc)", pan: "Pan (or hold Space)", text: "Add annotation", scale: "Set scale: click two points of a known distance" }[t]}>
                {{ select: "Select", pan: "Pan", text: "Text", scale: "Set scale" }[t]}
              </button>
            ))}
            <button className={tool === "route" ? "on" : ""} onClick={() => { setTool("route"); setArmed(null); setDrawPts([]); }}
              title="Draw a cable route: click points, double-click or Enter to finish">Route</button>
            {tool === "route" && (
              <select value={routeKind} onChange={(e) => setRouteKind(e.target.value as RouteKind)} style={{ width: "auto" }}>
                {ROUTE_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
              </select>
            )}
            <button className={coverage ? "on" : ""} onClick={() => setCoverage(!coverage)}
              title="Show Wi-Fi (15 m) and camera (30 m, 90°) coverage — needs scale">Coverage</button>
            <button className={heatmap ? "on" : ""} onClick={() => { if (!layout.scale_m_per_px) { setErr("Set the scale first — the heatmap needs real distances."); return; } setHeatmap(!heatmap); }}
              title="Predicted 5 GHz Wi-Fi signal from placed APs (open-space model, walls not included)">Heatmap</button>
            <button className={showRooms ? "on" : ""} onClick={() => setShowRooms(!showRooms)} title="Room names read from the drawing">Rooms{rooms.length ? ` (${rooms.length})` : ""}</button>
            <button onClick={() => runSuggest("auto")} disabled={sugBusy} title="Suggest equipment positions (AI if configured, else Wi-Fi grid)">
              {sugBusy ? "Thinking…" : "Suggest"}</button>
            <button onClick={() => zoomBy(1.25)} title="Zoom in">＋</button>
            <button onClick={() => zoomBy(0.8)} title="Zoom out">－</button>
            <button onClick={fit} title="Fit drawing">Fit</button>
            <span className="small muted" style={{ alignSelf: "center", padding: "0 4px" }}>{Math.round(view.scale * 100)}%</span>
          </div>
          <div className="ed-hint">
            {tool === "scale" ? `Set scale: click point ${scalePts.length + 1} of 2` :
              armed ? `Placing ${itemMap.get(armed)?.cat.name} — click the drawing. Esc to stop.` :
              tool === "text" ? "Click the drawing to add a note" :
              tool === "route" ? `Drawing ${ROUTE_KINDS.find((k) => k.kind === routeKind)?.label} route: click to add points (${drawPts.length / 2}), double-click or Enter to finish, Esc to cancel` :
              "Wheel = zoom · Space+drag = pan · Shift+click = multi-select · R = rotate · Ctrl+D = duplicate · Del = delete"}
          </div>
          <Stage ref={stage} width={Math.max(1, size.w)} height={Math.max(1, size.h)} scaleX={view.scale} scaleY={view.scale} x={view.x} y={view.y}
            draggable={draggable} onWheel={onWheel} onClick={onStageClick} onTap={onStageClick}
            onDblClick={() => { if (tool === "route") finishRoute(drawPts.slice(0, -2).length >= 4 ? drawPts.slice(0, -2) : drawPts); }}
            onDragEnd={(e) => { if (e.target === stage.current) setView({ ...view, x: e.target.x(), y: e.target.y() }); }}>
            <Layer listening={true}>
              <Rect name="bg" x={0} y={0} width={layout.width} height={layout.height} fill="#fff" />
              {img && <KImage name="bg" image={img} width={layout.width} height={layout.height} />}
              {heatCanvas && <KImage image={heatCanvas} width={layout.width} height={Math.ceil(layout.height / (layout.width / 220)) * (layout.width / 220)} listening={false} imageSmoothingEnabled />}
              {showRooms && rooms.map((r, i) => (
                <Text key={i} x={r.x} y={r.y} text={r.text} fontSize={S * 0.55} fill="#0f766e" fontStyle="bold" offsetX={r.text.length * S * 0.15} listening={false} />
              ))}
            </Layer>
            <Layer>
              {visible("Routes") && routes.map((r) => {
                const col = ROUTE_KINDS.find((k) => k.kind === r.kind)?.color || "#000";
                const isSel = sel.includes(r.key);
                return (
                  <Line key={r.key} points={r.points} stroke={col} strokeWidth={S * (isSel ? 0.35 : 0.22)} lineCap="round" lineJoin="round"
                    dash={r.kind === "tray" ? [S, S * 0.4] : r.kind === "conduit" ? [S * 0.3, S * 0.3] : undefined}
                    hitStrokeWidth={S} {...(isSel ? { shadowColor: "#ffbf00", shadowBlur: S, shadowOpacity: 1 } : {})}
                    onMouseDown={(e) => { if (tool === "select" && !locked("Routes")) pick(r.key, e); }} />
                );
              })}
              {coverage && scale && placements.map((p) => {
                const info = itemMap.get(p.catalogue_item_id); if (!info || !visible(info.cat.layer)) return null;
                if (info.cat.point_type === "Wi-Fi")
                  return <Circle key={"cv" + p.key} x={p.x} y={p.y} radius={(info.cat.symbol === "OAP" ? 40 : 15) / scale} fill="#7c3aed" opacity={0.12} stroke="#7c3aed" strokeWidth={S * 0.05} listening={false} />;
                if (info.cat.point_type === "CCTV" && info.cat.symbol !== "NVR")
                  return <Wedge key={"cv" + p.key} x={p.x} y={p.y} radius={(info.cat.symbol === "PTZ" ? 60 : info.cat.symbol === "ANPR" ? 15 : 30) / scale}
                    angle={info.cat.symbol === "PTZ" ? 360 : info.cat.symbol === "ANPR" ? 30 : 90} rotation={p.rotation - (info.cat.symbol === "PTZ" ? 0 : info.cat.symbol === "ANPR" ? 15 : 45)}
                    fill="#dc2626" opacity={0.12} listening={false} />;
                return null;
              })}
              {placements.map((p) => {
                const info = itemMap.get(p.catalogue_item_id); if (!info) return null;
                const lay = info.cat.layer;
                if (!visible(lay)) return null;
                const isSel = sel.includes(p.key);
                const w = S * 2.4, h = S * 1.3;
                return (
                  <Group key={p.key} x={p.x} y={p.y} draggable={!locked(lay) && tool === "select" && !space}
                    onMouseDown={(e) => pick(p.key, e)} onTap={(e) => pick(p.key, e)}
                    onDragStart={(e) => { if (!sel.includes(p.key)) setSel([p.key]); e.cancelBubble = true; }}
                    onDragEnd={(e) => {
                      e.cancelBubble = true;
                      const dx = e.target.x() - p.x, dy = e.target.y() - p.y;
                      const moving = sel.includes(p.key) ? sel : [p.key];
                      commit(placements.map((q) => (moving.includes(q.key) ? { ...q, x: q.x + dx, y: q.y + dy } : q)),
                        annotations.map((a) => (moving.includes(a.key) ? { ...a, x: a.x + dx, y: a.y + dy } : a)));
                    }}>
                    <Group rotation={p.rotation}>
                      <Rect x={-w / 2} y={-h / 2} width={w} height={h} cornerRadius={h / 2} fill={info.cat.color}
                        stroke={isSel ? "#ffbf00" : "#fff"} strokeWidth={isSel ? S * 0.25 : S * 0.08} {...(isSel ? { shadowBlur: S * 0.4, shadowColor: "#000", shadowOpacity: 0.3 } : {})} />
                      <Line points={[w / 2 - S * 0.05, -S * 0.3, w / 2 + S * 0.35, 0, w / 2 - S * 0.05, S * 0.3]} closed fill={info.cat.color} />
                    </Group>
                    <Text text={info.cat.symbol} fontSize={S * 0.62} fontStyle="bold" fill="#fff" width={w} align="center" x={-w / 2} y={-S * 0.31} listening={false} />
                    {showIds && <Text text={p.equip_code || "new"} fontSize={S * 0.48} fill="#111" x={-w} width={w * 2} align="center" y={h / 2 + S * 0.1}
                      listening={false} stroke="#fff" strokeWidth={S * 0.12} fillAfterStrokeEnabled />}
                    {locked(lay) && <Circle x={w / 2} y={-h / 2} radius={S * 0.22} fill="#666" listening={false} />}
                  </Group>
                );
              })}
              {visible("Annotations") && annotations.map((a) => (
                <Text key={a.key} x={a.x} y={a.y} text={a.text} fontSize={S * 0.8} fill="#b00020" padding={S * 0.15}
                  stroke={sel.includes(a.key) ? "#ffbf00" : undefined} strokeWidth={sel.includes(a.key) ? S * 0.04 : 0}
                  draggable={!locked("Annotations") && tool === "select" && !space}
                  onMouseDown={(e) => pick(a.key, e)} onTap={(e) => pick(a.key, e)}
                  onDblClick={() => {
                    const t = prompt("Edit annotation", a.text); if (t === null) return;
                    commit(placements, t.trim() ? annotations.map((x) => (x.key === a.key ? { ...x, text: t } : x)) : annotations.filter((x) => x.key !== a.key));
                  }}
                  onDragEnd={(e) => { e.cancelBubble = true; commit(placements, annotations.map((x) => (x.key === a.key ? { ...x, x: e.target.x(), y: e.target.y() } : x))); }} />
              ))}
              {drawPts.length >= 2 && (
                <>
                  <Line points={drawPts} stroke={ROUTE_KINDS.find((k) => k.kind === routeKind)?.color} strokeWidth={S * 0.22} dash={[S * 0.6, S * 0.3]} listening={false} />
                  {Array.from({ length: drawPts.length / 2 }, (_, i) => <Circle key={i} x={drawPts[i * 2]} y={drawPts[i * 2 + 1]} radius={S * 0.2} fill="#111" listening={false} />)}
                </>
              )}
              {sugs.map((sg) => {
                const info = itemMap.get(sg.catalogue_item_id); if (!info) return null;
                const w = S * 2.4, h = S * 1.3;
                return (
                  <Group key={sg.key} x={sg.x} y={sg.y} opacity={0.55} onClick={(e) => { e.cancelBubble = true; acceptSugs([sg.key]); }}>
                    <Rect x={-w / 2} y={-h / 2} width={w} height={h} cornerRadius={h / 2} fill={info.cat.color} stroke="#111" strokeWidth={S * 0.08} dash={[S * 0.3, S * 0.2]} />
                    <Text text={info.cat.symbol + "?"} fontSize={S * 0.6} fontStyle="bold" fill="#fff" width={w} align="center" x={-w / 2} y={-S * 0.3} />
                  </Group>
                );
              })}
              {scalePts.length > 0 && (
                <>
                  {scalePts.map((pt, i) => <Circle key={i} x={pt.x} y={pt.y} radius={S * 0.3} fill="#e11d48" />)}
                  {scalePts.length === 2 && <Line points={[scalePts[0].x, scalePts[0].y, scalePts[1].x, scalePts[1].y]} stroke="#e11d48" strokeWidth={S * 0.15} dash={[S, S / 2]} />}
                </>
              )}
            </Layer>
          </Stage>
        </div>

        {/* properties */}
        <aside className="ed-right">
          {(sugs.length > 0 || sugNote) && (
            <div className="card" style={{ marginBottom: 12, padding: 10 }}>
              <h3>Suggestions</h3>
              <div className="muted small" style={{ marginBottom: 6 }}>{sugNote}</div>
              {sugs.length > 0 && (
                <>
                  <div className="row" style={{ marginBottom: 6 }}>
                    <button className="primary" onClick={() => acceptSugs(sugs.map((s) => s.key))}>Accept all {sugs.length}</button>
                    <button onClick={() => { setSugs([]); setSugNote(""); }}>Reject all</button>
                  </div>
                  <div className="muted small">Click a faded symbol on the drawing to accept just that one. Accepted items can then be moved or deleted.</div>
                  <div style={{ maxHeight: 160, overflow: "auto", marginTop: 6 }}>
                    {sugs.map((sg) => (
                      <div key={sg.key} className="row small" style={{ justifyContent: "space-between" }}>
                        <span><b>{sg.symbol}</b> {sg.room} <span className="muted">{sg.reason}</span></span>
                        <span><button className="ghost" onClick={() => acceptSugs([sg.key])}>✓</button><button className="ghost" onClick={() => setSugs(sugs.filter((x) => x.key !== sg.key))}>✕</button></span>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {!sugs.length && <button onClick={() => setSugNote("")}>Close</button>}
            </div>
          )}
          {selR.length === 1 && selP.length === 0 && selA.length === 0 ? (
            <div>
              <h3>Cable route</h3>
              <label>Type<select value={selR[0].kind} onChange={(e) => commit(placements, annotations, routes.map((r) => r.key === selR[0].key ? { ...r, kind: e.target.value as RouteKind } : r))}>
                {ROUTE_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}</select></label>
              <label>Label<input value={selR[0].label} onChange={(e) => commit(placements, annotations, routes.map((r) => r.key === selR[0].key ? { ...r, label: e.target.value } : r))} placeholder="e.g. Backbone to FF rack" /></label>
              <label>Vertical rise / drop (m)<input type="number" min={0} value={selR[0].vertical_m} onChange={(e) => commit(placements, annotations, routes.map((r) => r.key === selR[0].key ? { ...r, vertical_m: Math.max(0, Number(e.target.value)) } : r))} /></label>
              <div className="small" style={{ marginBottom: 8 }}>Length: {routeLen(selR[0]) != null ? <b>{routeLen(selR[0])!.toFixed(1)} m</b> : <span className="badge warn">set scale to measure</span>} · {selR[0].points.length / 2} points</div>
              <button className="danger" onClick={removeSel}>Delete route</button>
            </div>
          ) : selP.length === 1 && selA.length === 0 ? (
            <Props p={selP[0]} cats={cats} itemMap={itemMap} scale={layout.scale_m_per_px} racks={racksHere}
              onChange={(patch) => update([selP[0].key], patch)} onDelete={removeSel} onDuplicate={duplicateSel} />
          ) : sel.length > 1 ? (
            <div>
              <h3>{sel.length} selected</h3>
              <label>Phase<select value="" onChange={(e) => e.target.value && update(selP.map((p) => p.key), { phase: e.target.value })}>
                <option value="">— set phase —</option>{PHASES.map((x) => <option key={x}>{x}</option>)}</select></label>
              <label>Room / location<input placeholder="Set room for all" onKeyDown={(e) => {
                if (e.key === "Enter") update(selP.map((p) => p.key), { room: (e.target as HTMLInputElement).value });
              }} /></label>
              <div className="row"><button onClick={() => rotateSel(90)}>Rotate 90°</button><button onClick={duplicateSel}>Duplicate</button><button className="danger" onClick={removeSel}>Delete</button></div>
            </div>
          ) : selA.length === 1 ? (
            <div>
              <h3>Annotation</h3>
              <label>Text<textarea rows={3} value={selA[0].text} onChange={(e) => commit(placements, annotations.map((a) => (a.key === selA[0].key ? { ...a, text: e.target.value } : a)))} /></label>
              <button className="danger" onClick={removeSel}>Delete</button>
            </div>
          ) : (
            <div className="muted small">Select an item to edit its properties.</div>
          )}

          <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "14px 0" }} />
          {heatmap && (
            <div className="small" style={{ marginBottom: 10 }}>
              <b>Wi-Fi heatmap (5 GHz, predicted)</b>
              {[["#16a34a", "≥ −60 dBm excellent"], ["#84cc16", "−67 good (voice)"], ["#eab308", "−72 fair (data)"], ["#ea580c", "−78 weak"]].map(([c, t]) => (
                <div key={t}><span style={{ display: "inline-block", width: 12, height: 10, background: c, marginRight: 6 }} />{t}</div>
              ))}
              <div className="muted">Open-space model; walls reduce signal further — use it to spot gaps, then confirm with a site survey.</div>
            </div>
          )}
          {(showRooms || roomNote) && (
            <div className="small" style={{ marginBottom: 10 }}>
              <b>Room names</b> <span className="muted">{rooms.length ? `${rooms.length} read from the drawing.` : ""} {roomNote}</span>
              {rooms.length > 0 && <div><button style={{ marginTop: 4 }} onClick={autofillRooms}>Fill empty rooms from drawing</button></div>}
            </div>
          )}
          <h3>Layers</h3>
          {layerNames.map((l) => (
            <div className="layer-row" key={l}>
              <input type="checkbox" checked={visible(l)} onChange={(e) => setLayer(l, { visible: e.target.checked })} id={`ly-${l}`} />
              <label htmlFor={`ly-${l}`} style={{ margin: 0, flex: 1, color: "var(--text)", fontSize: 13 }}>{l}</label>
              <button className={`ghost small ${locked(l) ? "on" : ""}`} onClick={() => setLayer(l, { locked: !locked(l) })} title="Lock layer">{locked(l) ? "Locked" : "Lock"}</button>
            </div>
          ))}
          <div className="row" style={{ marginTop: 8 }}>
            <label style={{ margin: 0, flex: 1 }}>Symbol size
              <input type="range" min={0.4} max={3} step={0.1} value={symScale} onChange={(e) => setSymScale(Number(e.target.value))} /></label>
          </div>
          <label className="row" style={{ color: "var(--text)" }}><input type="checkbox" style={{ width: "auto" }} checked={showIds} onChange={(e) => setShowIds(e.target.checked)} /> Show equipment IDs</label>

          <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "14px 0" }} />
          <h3>This layout</h3>
          {routes.length > 0 && (
            <table className="totals" style={{ marginBottom: 6 }}><tbody>
              {ROUTE_KINDS.filter((k) => routes.some((r) => r.kind === k.kind)).map((k) => {
                const m = routes.filter((r) => r.kind === k.kind).reduce((a, r) => a + (routeLen(r) || 0), 0);
                return <tr key={k.kind}><td><span style={{ display: "inline-block", width: 18, height: 3, background: k.color, verticalAlign: "middle" }} /></td><td>{k.label} route</td><td className="num">{scale ? `${m.toFixed(0)} m` : "–"}</td></tr>;
              })}
            </tbody></table>
          )}
          {totals.byCat.length === 0 ? <div className="muted small">Nothing placed yet.</div> : (
            <table className="totals"><tbody>
              {totals.byCat.map(({ cat, n }) => (
                <tr key={cat.id}><td><span className="sym" style={{ background: cat.color }}>{cat.symbol}</span></td><td>{cat.name}</td><td className="num"><b>{n}</b></td></tr>
              ))}
            </tbody></table>
          )}
          {totals.byPoint.length > 0 && (
            <>
              <div className="muted small" style={{ marginTop: 8 }}>Network points</div>
              <table className="totals"><tbody>
                {totals.byPoint.map(([t, n]) => <tr key={t}><td>{t}</td><td className="num">{n}</td></tr>)}
                <tr><td><b>Total</b></td><td className="num"><b>{totals.byPoint.reduce((a, [, n]) => a + n, 0)}</b></td></tr>
              </tbody></table>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function Props({ p, cats, itemMap, scale, racks, onChange, onDelete, onDuplicate }: {
  racks: PlacementT[];
  p: PlacementT; cats: Category[]; itemMap: Map<number, { item: Item; cat: Category }>; scale: number | null;
  onChange: (patch: Partial<PlacementT>) => void; onDelete: () => void; onDuplicate: () => void;
}) {
  const info = itemMap.get(p.catalogue_item_id);
  if (!info) return null;
  const { item, cat } = info;
  const rate = item.vendor_rate ?? item.indicative_rate;
  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="sym" style={{ background: cat.color }}>{cat.symbol}</span>
        <b>{p.equip_code || <span className="muted">ID assigned on save</span>}</b>
      </div>
      <label>Equipment type<select value={cat.id} onChange={(e) => {
        const c = cats.find((x) => x.id === Number(e.target.value)); const first = c?.items.find((i) => i.is_active);
        if (c && first) onChange({ catalogue_item_id: first.id, ports: c.ports_required });
      }}>
        {cats.map((c) => <option key={c.id} value={c.id}>{c.group} › {c.name}</option>)}
      </select></label>
      <label>Make / model<select value={item.id} onChange={(e) => onChange({ catalogue_item_id: Number(e.target.value) })}>
        {cat.items.filter((i) => i.is_active || i.id === item.id).map((i) => <option key={i.id} value={i.id}>{i.manufacturer} {i.model}</option>)}
      </select></label>
      <div className="muted small" style={{ marginBottom: 8 }}>{item.description}{item.specs ? ` · ${item.specs}` : ""}<br />
        Rate ₹{rate.toLocaleString("en-IN")} ({item.vendor_rate != null ? "vendor" : "indicative"}, ex-GST)</div>
      <label>Room / location<input value={p.room} onChange={(e) => onChange({ room: e.target.value })} placeholder="e.g. Cabin D1" /></label>
      <div className="form" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <label>Phase<select value={p.phase} onChange={(e) => onChange({ phase: e.target.value })}>{PHASES.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label>Network points<input type="number" min={0} max={48} value={p.ports} onChange={(e) => onChange({ ports: Math.max(0, Number(e.target.value)) })} /></label>
        <label>Rotation °<input type="number" value={Math.round(p.rotation)} onChange={(e) => onChange({ rotation: ((Number(e.target.value) % 360) + 360) % 360 })} /></label>
        <label>Layer<input value={cat.layer} readOnly /></label>
      </div>
      {cat.point_type && cat.symbol !== "RK" && (
        <label>Serving rack<select value={p.serving_rack_id ?? ""} onChange={(e) => onChange({ serving_rack_id: e.target.value ? Number(e.target.value) : null })}>
          <option value="">Auto (nearest rack)</option>
          {racks.map((r) => <option key={r.id} value={r.id}>{r.equip_code}</option>)}
        </select></label>
      )}
      <label>Remarks<textarea rows={2} value={p.remarks} onChange={(e) => onChange({ remarks: e.target.value })} /></label>
      <div className="muted small" style={{ marginBottom: 8 }}>Position {Math.round(p.x)}, {Math.round(p.y)} px{scale ? ` (${(p.x * scale).toFixed(1)} m, ${(p.y * scale).toFixed(1)} m)` : ""}</div>
      <div className="row">
        <button onClick={() => onChange({ rotation: (p.rotation + 90) % 360 })}>Rotate 90°</button>
        <button onClick={onDuplicate}>Duplicate</button>
        <button className="danger" onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
}

function clamp(v: number, a: number, b: number) { return Math.max(a, Math.min(b, v)); }
