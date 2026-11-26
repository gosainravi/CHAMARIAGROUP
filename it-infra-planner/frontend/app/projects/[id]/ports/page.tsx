"use client";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import Shell from "@/components/Shell";
import ProjectTabs from "@/components/ProjectTabs";
import { api2, download, PmRow, PortMatrix } from "@/lib/api";

type View = "summary" | "project" | "building" | "floor" | "rack" | "switch";
const VIEWS: [View, string][] = [["summary", "Summary"], ["project", "Complete project"], ["building", "Building-wise"],
  ["floor", "Floor-wise"], ["rack", "Rack-wise"], ["switch", "Switch-wise"]];

function Cell({ row, field, value, onSave, width = 54 }: { row: PmRow; field: string; value: string | number | null; onSave: (row: PmRow, field: string, v: string) => void; width?: number }) {
  return (
    <input key={`${row.placement_id}-${row.point_index}-${field}-${value}`} defaultValue={value ?? ""} style={{ width }}
      className={`cell-in ${row.overridden.includes(field) ? "edited" : ""}`}
      onBlur={(e) => { if (e.target.value !== String(value ?? "")) onSave(row, field, e.target.value); }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
  );
}

export default function Ports() {
  const id = Number(useParams<{ id: string }>().id);
  const [pm, setPm] = useState<PortMatrix | null>(null);
  const [view, setView] = useState<View>("summary");
  const [filter, setFilter] = useState("");
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  const [showIssues, setShowIssues] = useState(true);
  useEffect(() => { api2.portMatrix(id).then(setPm).catch((e) => setErr(e.message)); }, [id]);

  const groupKey = (r: PmRow) => ({ project: "", summary: "", building: r.building, floor: `${r.building} – ${r.floor}`, rack: r.rack || "Unassigned", switch: r.switch || "Unassigned" }[view]);
  const groups = useMemo(() => Array.from(new Set((pm?.rows || []).map(groupKey))).sort(), [pm, view]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setFilter(""); }, [view]);
  const rows = (pm?.rows || []).filter((r) => (!filter || groupKey(r) === filter) &&
    (!q || `${r.equip_code} ${r.room} ${r.cable_id} ${r.destination} ${r.description}`.toLowerCase().includes(q.toLowerCase())));
  const issueKeys = new Map<string, string>();
  pm?.issues.forEach((i) => { if (i.placement_id != null) issueKeys.set(`${i.placement_id}-${i.point_index}`, i.level === "error" || issueKeys.get(`${i.placement_id}-${i.point_index}`) === "error" ? "error" : "warning"); });

  const save = async (row: PmRow, field: string, v: string) => {
    if (["switch_no", "switch_port", "pp_no", "pp_port", "rack_id"].includes(field) && v.trim() !== "" && !(Number(v) >= 1)) {
      setErr(`${field.replace("_", " ")} must be a whole number ≥ 1`); return;
    }
    try { setPm(await api2.editPort(id, row.placement_id, row.point_index, { [field]: v.trim() === "" ? null : v })); }
    catch (e) { setErr((e as Error).message); }
  };
  const errors = pm?.issues.filter((i) => i.level === "error").length ?? 0;
  const warns = pm?.issues.filter((i) => i.level === "warning").length ?? 0;

  return (
    <Shell>
      <ProjectTabs id={id} title="Port Matrix" actions={<>
        <button onClick={async () => { if (confirm("Remove all manual port changes and re-run automatic allocation?")) setPm(await api2.resetPorts(id)); }}>Re-allocate automatically</button>
        <button className="primary" onClick={() => download(`/api/projects/${id}/port-matrix.xlsx`).catch((e) => setErr(e.message))}>Export Excel</button>
      </>} />
      {err && <div className="error" onClick={() => setErr("")}>{err}</div>}
      {!pm ? <div className="muted">Calculating…</div> : (
        <>
          <div className="grid kpis">
            <div className="card kpi"><span className="muted">Network points</span><b>{pm.rows.length}</b></div>
            <div className="card kpi"><span className="muted">Racks</span><b>{pm.racks.length}</b><span className="small muted">core {pm.core_rack || "–"}</span></div>
            <div className="card kpi"><span className="muted">Switches / patch panels</span><b>{pm.racks.reduce((a, r) => a + r.switches, 0)} / {pm.racks.reduce((a, r) => a + r.patch_panels, 0)}</b>
              <span className="small muted">{pm.settings.switch_ports} ports, {pm.settings.spare_pct}% spare</span></div>
            <div className="card kpi" style={{ cursor: "pointer" }} onClick={() => setShowIssues(!showIssues)}>
              <span className="muted">Validation</span><b><span className={errors ? "issue-err" : ""}>{errors} errors</span> · <span className={warns ? "issue-warn" : ""}>{warns} warnings</span></b></div>
          </div>
          {showIssues && pm.issues.length > 0 && (
            <div className="card" style={{ marginBottom: 12, maxHeight: 180, overflow: "auto" }}>
              {pm.issues.map((i, k) => <div key={k} className={`small ${i.level === "error" ? "issue-err" : "issue-warn"}`}>{i.level === "error" ? "✖" : "⚠"} {i.message}</div>)}
            </div>
          )}
          <div className="row noprint" style={{ marginBottom: 10 }}>
            <div className="seg">{VIEWS.map(([v, l]) => <button key={v} className={view === v ? "on" : ""} onClick={() => setView(v)}>{l}</button>)}</div>
            {!["summary", "project"].includes(view) && (
              <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: "auto" }}>
                <option value="">All {view}s</option>{groups.map((g) => <option key={g}>{g}</option>)}
              </select>
            )}
            {view !== "summary" && <input placeholder="Search ID, room, cable ID" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 240 }} />}
            <span className="muted small">{view !== "summary" ? `${rows.length} rows · shaded cells were changed by hand · edit a cell and press Enter` : ""}</span>
          </div>

          {view === "summary" ? (
            <div className="card scroll">
              <table>
                <thead><tr><th>S.No</th><th>Building</th><th>Floor</th><th>Location</th>{pm.summary.types.map((t) => <th key={t} className="num">{t}</th>)}<th className="num">Total</th><th>Rack</th></tr></thead>
                <tbody>
                  {pm.summary.rows.map((r, i) => (
                    <tr key={i}><td>{i + 1}</td><td>{r.building}</td><td>{r.floor}</td><td>{r.location}</td>
                      {pm.summary.types.map((t) => <td key={t} className="num">{(r[t] as number) || ""}</td>)}<td className="num"><b>{r.total}</b></td><td className="small">{r.racks}</td></tr>
                  ))}
                  <tr className="tot"><td></td><td colSpan={3}>Total</td>{pm.summary.types.map((t) => <td key={t} className="num">{pm.summary.totals[t]}</td>)}<td className="num">{pm.summary.totals.total}</td><td></td></tr>
                </tbody>
              </table>
            </div>
          ) : (
            <div className="card scroll">
              <table>
                <thead><tr>
                  <th>S.No</th><th>Building</th><th>Floor</th><th>Room</th><th>Equipment ID</th><th>Description</th><th>Type</th>
                  <th>Rack</th><th>Switch</th><th>Sw No</th><th>Sw Port</th><th>Patch panel</th><th>PP No</th><th>PP Port</th><th>Cable ID</th>
                  <th>Destination</th><th>VLAN</th><th className="num">Length m</th><th>Remarks</th>
                </tr></thead>
                <tbody>
                  {rows.map((r) => {
                    const lvl = issueKeys.get(`${r.placement_id}-${r.point_index}`);
                    return (
                      <tr key={`${r.placement_id}-${r.point_index}`} style={lvl === "error" ? { outline: "1px solid var(--danger)" } : undefined}>
                        <td>{r.sn}{lvl && <span className={lvl === "error" ? "issue-err" : "issue-warn"}> {lvl === "error" ? "✖" : "⚠"}</span>}</td>
                        <td>{r.building}</td><td>{r.floor}</td><td>{r.room || <span className="issue-warn">—</span>}</td>
                        <td className="code">{r.equip_code}{r.point_index > 0 ? ` /${r.point_index + 1}` : ""}</td>
                        <td>{r.description}</td><td>{r.point_type} <span className="muted small">{r.cable}</span></td>
                        <td>
                          <select value={r.rack_id ?? ""} onChange={(e) => save(r, "rack_id", e.target.value)} className={r.overridden.includes("rack") ? "edited" : ""} style={{ width: 130, padding: 2 }}>
                            {!r.rack_id && <option value="">Unassigned</option>}
                            {pm.racks.map((k) => <option key={k.id} value={k.id}>{k.code}</option>)}
                          </select>
                        </td>
                        <td>{r.switch}</td>
                        <td><Cell row={r} field="switch_no" value={r.switch_no} onSave={save} width={40} /></td>
                        <td><Cell row={r} field="switch_port" value={r.switch_port} onSave={save} width={40} /></td>
                        <td>{r.patch_panel}</td>
                        <td><Cell row={r} field="pp_no" value={r.pp_no} onSave={save} width={40} /></td>
                        <td><Cell row={r} field="pp_port" value={r.pp_port} onSave={save} width={40} /></td>
                        <td className="code">{r.cable_id}</td>
                        <td><Cell row={r} field="destination" value={r.destination} onSave={save} width={170} /></td>
                        <td><Cell row={r} field="vlan" value={r.vlan} onSave={save} width={44} /></td>
                        <td className={`num ${r.length_m > 90 ? "issue-warn" : ""}`}>{r.length_m}</td>
                        <td><Cell row={r} field="remarks" value={r.remarks} onSave={save} width={140} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {rows.length === 0 && <div className="empty">No network points. Place equipment and racks on a layout first.</div>}
            </div>
          )}
        </>
      )}
    </Shell>
  );
}
