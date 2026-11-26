"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import ProjectTabs from "@/components/ProjectTabs";
import { api2, download, Qty } from "@/lib/api";

export default function Quantities() {
  const id = Number(useParams<{ id: string }>().id);
  const [qs, setQs] = useState<Qty[] | null>(null);
  const [issues, setIssues] = useState(0);
  const [err, setErr] = useState("");
  const load = () => api2.quantities(id).then((r) => { setQs(r.quantities); setIssues(r.issues); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = Array.from(new Set((qs || []).map((q) => q.group)));
  const setOv = async (q: Qty, raw: string) => {
    const v = raw.trim() === "" ? null : Number(raw);
    if (v !== null && (isNaN(v) || v < 0)) { setErr("Quantity must be a positive number"); return; }
    if (v === q.override) return;
    const reason = v === null ? "" : (prompt(`Reason for changing "${q.label}" from ${q.calc} to ${v}? (optional)`, q.reason) ?? "");
    try { const r = await api2.overrideQty(id, q.key, v, reason); setQs(r.quantities); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <Shell>
      <ProjectTabs id={id} title="Infrastructure quantities" actions={
        <button onClick={() => download(`/api/projects/${id}/schedule.xlsx`).catch((e) => setErr(e.message))}>Excel (schedule + quantities)</button>} />
      {err && <div className="error" onClick={() => setErr("")}>{err}</div>}
      <div className="muted" style={{ marginBottom: 10 }}>
        Calculated live from the equipment on the layouts and the port matrix. Type in <b>Adjusted</b> to override; clear it to go back to the calculated value.
        {issues > 0 && <> · <Link href={`/projects/${id}/ports`}>{issues} port-matrix issues</Link></>}
      </div>
      {qs && qs.length === 0 && <div className="card empty">Nothing placed yet.</div>}
      {groups.map((g) => (
        <div className="card" key={g} style={{ marginBottom: 12 }}>
          <h2>{g}</h2>
          <table>
            <thead><tr><th>Item</th><th>Unit</th><th className="num">Calculated</th><th className="num">Adjusted</th><th className="num">Used</th><th>How it is calculated</th></tr></thead>
            <tbody>
              {qs!.filter((q) => q.group === g).map((q) => (
                <tr key={q.key}>
                  <td>{q.label}{q.override !== null && <span className="badge warn" style={{ marginLeft: 6 }} title={q.reason}>adjusted</span>}</td>
                  <td>{q.unit}</td>
                  <td className="num">{q.calc}</td>
                  <td className="num">
                    <input key={`${q.key}-${q.override}`} className={`cell-in ${q.override !== null ? "edited" : ""}`} defaultValue={q.override ?? ""} placeholder="—"
                      onBlur={(e) => setOv(q, e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
                  </td>
                  <td className="num"><b>{q.value}</b></td>
                  <td className="muted small">{q.basis}{q.reason ? ` · Reason: ${q.reason}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </Shell>
  );
}
