"use client";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import ProjectTabs from "@/components/ProjectTabs";
import { api3, inr, Version, VersionSummary } from "@/lib/api";

const FIELDS: [keyof VersionSummary, string, boolean?][] = [
  ["placements", "Equipment placed"], ["points", "Network points"], ["racks", "Racks"], ["switches", "Switches"],
  ["cat6_m", "Cat6 m"], ["fiber_m", "Fibre m"], ["boq_lines", "BOQ lines"], ["material", "Material ₹", true], ["total", "Total ₹", true], ["errors", "Port errors"],
];

export default function Versions() {
  const id = Number(useParams<{ id: string }>().id);
  const [d, setD] = useState<{ current: VersionSummary; versions: Version[] } | null>(null);
  const [cmp, setCmp] = useState<number | null>(null);
  const [label, setLabel] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => { api3.versions(id).then(setD).catch((e) => setErr(e.message)); }, [id]);
  const other = d?.versions.find((v) => v.id === cmp);
  const fmt = (k: keyof VersionSummary, v: unknown, money?: boolean) => (money ? inr(Number(v)) : String(v ?? 0));
  const cats = other ? Array.from(new Set([...Object.keys(other.summary.by_category), ...Object.keys(d!.current.by_category)])).sort() : [];
  return (
    <Shell>
      <ProjectTabs id={id} title="Project versions" />
      {err && <div className="error" onClick={() => setErr("")}>{err}</div>}
      {msg && <div className="card small" style={{ marginBottom: 10 }}>{msg}</div>}
      <div className="card" style={{ marginBottom: 12 }}>
        <h2>Save a version</h2>
        <div className="muted small" style={{ marginBottom: 6 }}>A version stores all layouts&apos; equipment, routes and notes, plus port, quantity and BOQ edits and settings. Restoring one first saves the current state, so nothing is lost.</div>
        <div className="row">
          <input placeholder="e.g. Tender issue, Client review 1" value={label} onChange={(e) => setLabel(e.target.value)} style={{ maxWidth: 320 }} />
          <button className="primary" onClick={async () => { try { setD(await api3.saveVersion(id, label)); setLabel(""); setMsg("Version saved."); } catch (e) { setErr((e as Error).message); } }}>Save version</button>
        </div>
      </div>
      {d && (
        <div className="card" style={{ marginBottom: 12 }}>
          <h2>Versions</h2>
          {d.versions.length === 0 ? <div className="empty">No versions saved yet.</div> : (
            <table>
              <thead><tr><th>Version</th><th>Saved</th><th className="num">Equipment</th><th className="num">Points</th><th className="num">Total</th><th></th></tr></thead>
              <tbody>
                {d.versions.map((v) => (
                  <tr key={v.id}>
                    <td><b>{v.label}</b></td><td className="small muted">{new Date(v.created_at).toLocaleString("en-IN")}</td>
                    <td className="num">{v.summary.placements}</td><td className="num">{v.summary.points}</td><td className="num">{inr(v.summary.total)}</td>
                    <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                      <button className={cmp === v.id ? "on" : ""} onClick={() => setCmp(cmp === v.id ? null : v.id)}>Compare</button>{" "}
                      <button onClick={async () => {
                        if (!confirm(`Restore “${v.label}”? The current state is saved as a version first.`)) return;
                        try { const r = await api3.restore(v.id); setD(r); setMsg(`Restored “${r.restored}”.${r.skipped_layouts ? ` ${r.skipped_layouts} layout(s) no longer exist and were skipped.` : ""}`); }
                        catch (e) { setErr((e as Error).message); }
                      }}>Restore</button>{" "}
                      <button className="ghost danger" onClick={async () => { if (confirm(`Delete version “${v.label}”?`)) setD(await api3.deleteVersion(v.id)); }}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {d && other && (
        <div className="card">
          <h2>“{other.label}” vs current</h2>
          <table>
            <thead><tr><th></th><th className="num">{other.label}</th><th className="num">Current</th><th className="num">Change</th></tr></thead>
            <tbody>
              {FIELDS.map(([k, l, money]) => {
                const a = Number(other.summary[k] ?? 0), b = Number(d.current[k] ?? 0);
                return <tr key={k}><td>{l}</td><td className="num">{fmt(k, a, money)}</td><td className="num">{fmt(k, b, money)}</td>
                  <td className={`num ${b !== a ? "issue-warn" : ""}`}>{b === a ? "" : (b > a ? "+" : "−") + (money ? inr(Math.abs(b - a)) : Math.abs(b - a))}</td></tr>;
              })}
              {cats.map((c) => {
                const a = other.summary.by_category[c] || 0, b = d.current.by_category[c] || 0;
                return <tr key={c}><td className="muted">{c}</td><td className="num">{a}</td><td className="num">{b}</td><td className={`num ${b !== a ? "issue-warn" : ""}`}>{b === a ? "" : (b > a ? "+" : "−") + Math.abs(b - a)}</td></tr>;
              })}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}
