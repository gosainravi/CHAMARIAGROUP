"use client";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import ProjectTabs from "@/components/ProjectTabs";
import { api2, download, inr } from "@/lib/api";

type Report = Awaited<ReturnType<typeof api2.report>>;

export default function Reports() {
  const id = Number(useParams<{ id: string }>().id);
  const [r, setR] = useState<Report | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  useEffect(() => { api2.report(id).then(setR).catch((e) => setErr(e.message)); }, [id]);
  const dl = async (path: string, label: string) => {
    setBusy(label); setErr("");
    try { await download(path); } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  };
  const DELIVERABLES: [string, string, string][] = [
    ["1. Final IT Infrastructure Layout", "PDF", `/api/projects/${id}/drawings.pdf?mode=all`],
    ["2. Fibre and Cat6 Routing Layout", "PDF", `/api/projects/${id}/drawings.pdf?mode=routing`],
    ["3. Equipment Placement Schedule", "Excel", `/api/projects/${id}/schedule.xlsx`],
    ["4. Port Matrix", "Excel", `/api/projects/${id}/port-matrix.xlsx`],
    ["5. Complete BOQ (with budget sheet)", "Excel", `/api/projects/${id}/boq.xlsx`],
  ];
  const blds = r ? Object.keys(r.by_building) : [];
  const cats = r ? r.by_category.map(([c]) => c) : [];
  return (
    <Shell>
      <ProjectTabs id={id} title="Reports" actions={<button className="primary" onClick={() => window.print()}>Print / save summary as PDF</button>} />
      {err && <div className="error">{err}</div>}
      <div className="card noprint" style={{ marginBottom: 14 }}>
        <h2>Deliverables</h2>
        <table><tbody>
          {DELIVERABLES.map(([label, kind, path]) => (
            <tr key={label}><td>{label}</td><td><span className="badge">{kind}</span></td>
              <td style={{ textAlign: "right" }}><button disabled={!!busy} onClick={() => dl(path, label)}>{busy === label ? "Preparing…" : "Download"}</button></td></tr>
          ))}
          <tr><td>6–8. Budget report, category-wise and building-wise summaries</td><td><span className="badge">PDF</span></td>
            <td style={{ textAlign: "right" }}><button onClick={() => window.print()}>Print below</button></td></tr>
        </tbody></table>
      </div>
      {!r ? <div className="muted">Loading…</div> : (
        <div className="card">
          <h2>{r.project.name} — IT infrastructure summary</h2>
          <div className="muted">{[r.project.client, r.project.location, r.project.phase].filter(Boolean).join(" · ")} · {new Date().toLocaleDateString("en-IN")}</div>
          <h3 style={{ marginTop: 16 }}>6. Approximate IT budget</h3>
          <table style={{ maxWidth: 520 }}><tbody>
            <tr><td>Material cost</td><td className="num">{inr(r.budget.material)}</td></tr>
            <tr><td>Installation cost</td><td className="num">{inr(r.budget.install)}</td></tr>
            <tr><td>GST</td><td className="num">{inr(r.budget.gst)}</td></tr>
            <tr><td>Contingency {r.budget.contingency_pct}%</td><td className="num">{inr(r.budget.contingency)}</td></tr>
            <tr className="tot"><td>Total estimated project cost</td><td className="num">{inr(r.budget.total)}</td></tr>
          </tbody></table>
          <div className="muted small">{r.budget.pct_vendor}% of material value on vendor quotes; the rest indicative. Preliminary estimate, not a quotation.</div>
          <table style={{ marginTop: 10 }}>
            <thead><tr><th>Category</th><th className="num">Material</th><th className="num">Installation</th><th className="num">GST</th><th className="num">Total</th></tr></thead>
            <tbody>{r.budget.by_section.map((s) => <tr key={s.key}><td>{s.label}</td><td className="num">{inr(s.material)}</td><td className="num">{inr(s.install)}</td><td className="num">{inr(s.gst)}</td><td className="num">{inr(s.total)}</td></tr>)}</tbody>
          </table>
          <table style={{ marginTop: 10 }}>
            <thead><tr><th>Building</th><th className="num">Total</th><th>Phase</th><th className="num">Total</th></tr></thead>
            <tbody>{Array.from({ length: Math.max(r.budget.by_building.length, r.budget.by_phase.length) }, (_, i) => (
              <tr key={i}><td>{r.budget.by_building[i]?.label}</td><td className="num">{r.budget.by_building[i] ? inr(r.budget.by_building[i].total) : ""}</td>
                <td>{r.budget.by_phase[i]?.label}</td><td className="num">{r.budget.by_phase[i] ? inr(r.budget.by_phase[i].total) : ""}</td></tr>))}</tbody>
          </table>

          <h3 className="pagebreak" style={{ marginTop: 18 }}>7. Category-wise equipment summary</h3>
          <table style={{ maxWidth: 520 }}><tbody>{r.by_category.map(([c, n]) => <tr key={c}><td>{c}</td><td className="num">{n}</td></tr>)}</tbody></table>
          <div className="small" style={{ marginTop: 6 }}>Network points: {Object.entries(r.points).filter(([, n]) => n).map(([t, n]) => `${t} ${n}`).join(" · ")}</div>

          <h3 style={{ marginTop: 18 }}>8. Building-wise equipment summary</h3>
          <table>
            <thead><tr><th>Category</th>{blds.map((b) => <th key={b} className="num">{b}</th>)}<th className="num">Total</th></tr></thead>
            <tbody>{cats.map((c) => (
              <tr key={c}><td>{c}</td>{blds.map((b) => <td key={b} className="num">{r.by_building[b][c] || ""}</td>)}<td className="num"><b>{blds.reduce((a, b) => a + (r.by_building[b][c] || 0), 0)}</b></td></tr>))}</tbody>
          </table>

          <h3 className="pagebreak" style={{ marginTop: 18 }}>Equipment placement schedule ({r.schedule.length})</h3>
          <table>
            <thead><tr><th>Equipment ID</th><th>Category</th><th>Make / model</th><th>Building</th><th>Floor</th><th>Room</th><th>Phase</th><th className="num">Points</th></tr></thead>
            <tbody>{r.schedule.map((s) => <tr key={s.equip_code}><td className="code">{s.equip_code}</td><td>{s.category}</td><td>{s.make} {s.model}</td><td>{s.building}</td><td>{s.floor}</td><td>{s.room}</td><td>{s.phase}</td><td className="num">{s.points || ""}</td></tr>)}</tbody>
          </table>

          {r.layouts.length > 0 && <>
            <h3 className="pagebreak" style={{ marginTop: 18 }}>Final layouts</h3>
            {r.layouts.map((l) => (
              <div key={l.id} style={{ marginBottom: 14, breakInside: "avoid" }}>
                <div className="small"><b>{l.building} · {l.floor} · {l.name}</b></div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={api2.file(`/api/layouts/${l.id}/render.png?mode=all`)} alt={l.name} style={{ width: "100%", border: "1px solid var(--line)" }} loading="lazy" />
              </div>
            ))}
          </>}
        </div>
      )}
    </Shell>
  );
}
