"use client";
import { useState } from "react";
import { Project } from "@/lib/api";

export const PHASES = ["Planning", "Design", "Tender", "Execution", "Handover"];
export const STATUSES = ["Draft", "In progress", "On hold", "Approved", "Completed"];

export default function ProjectForm({ initial, submitLabel, onSubmit, onCancel }: {
  initial?: Partial<Project>; submitLabel: string;
  onSubmit: (p: Partial<Project>) => Promise<void>; onCancel?: () => void;
}) {
  const [f, setF] = useState<Partial<Project>>({
    name: "", client: "", location: "", description: "", num_buildings: 1, num_floors: 1,
    phase: "Planning", status: "Draft", ...initial,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: keyof Project) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.type === "number" ? Number(e.target.value) : e.target.value });
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      if (!f.name?.trim()) { setErr("Project name is required"); return; }
      setBusy(true); setErr("");
      try { await onSubmit(f); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
    }}>
      <div className="form">
        <label>Project name *<input value={f.name} onChange={set("name")} autoFocus /></label>
        <label>Client / company<input value={f.client} onChange={set("client")} /></label>
        <label>Location<input value={f.location} onChange={set("location")} /></label>
        <label>Buildings<input type="number" min={1} max={50} value={f.num_buildings} onChange={set("num_buildings")} /></label>
        <label>Floors per building<input type="number" min={1} max={60} value={f.num_floors} onChange={set("num_floors")} /></label>
        <label>Phase<select value={f.phase} onChange={set("phase")}>{PHASES.map((p) => <option key={p}>{p}</option>)}</select></label>
        <label>Status<select value={f.status} onChange={set("status")}>{STATUSES.map((p) => <option key={p}>{p}</option>)}</select></label>
      </div>
      <label>Description<textarea rows={2} value={f.description} onChange={set("description")} /></label>
      {err && <div className="error">{err}</div>}
      <div className="row">
        <button className="primary" disabled={busy}>{busy ? "Saving…" : submitLabel}</button>
        {onCancel && <button type="button" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}
