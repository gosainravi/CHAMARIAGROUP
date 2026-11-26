"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import ProjectTabs from "@/components/ProjectTabs";
import { api2, Budget, BudgetRow, download, inr } from "@/lib/api";

const VIEWS: [keyof Budget, string][] = [["by_section", "Category-wise"], ["by_building", "Building-wise"], ["by_floor", "Floor-wise"], ["by_phase", "Phase-wise"]];

export default function BudgetPage() {
  const id = Number(useParams<{ id: string }>().id);
  const [b, setB] = useState<Budget | null>(null);
  const [view, setView] = useState<keyof Budget>("by_section");
  const [err, setErr] = useState("");
  useEffect(() => { api2.budget(id).then(setB).catch((e) => setErr(e.message)); }, [id]);
  const rows = (b?.[view] as BudgetRow[]) || [];
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <Shell>
      <ProjectTabs id={id} title="Approximate IT budget" actions={<>
        <button onClick={() => window.print()}>Print / PDF</button>
        <button className="primary" onClick={() => download(`/api/projects/${id}/boq.xlsx`).catch((e) => setErr(e.message))}>Export Excel</button>
      </>} />
      {err && <div className="error">{err}</div>}
      {!b ? <div className="muted">Calculating…</div> : (
        <>
          <div className="muted" style={{ marginBottom: 10 }}>
            Preliminary estimate from the BOQ — not a quotation or purchase order. Rates are ex-GST; GST is added once.
            {" "}<b>{b.pct_vendor}%</b> of material value is on vendor quotes, {b.pct_manual}% on rates typed in the BOQ, the rest on indicative catalogue rates.
            {" "}Update rates in the <Link href="/catalogue">Equipment Library</Link> or the <Link href={`/projects/${id}/boq`}>BOQ</Link>.
          </div>
          <div className="grid kpis">
            <div className="card kpi"><span className="muted">Material cost</span><b>{inr(b.material)}</b></div>
            <div className="card kpi"><span className="muted">Installation cost</span><b>{inr(b.install)}</b></div>
            <div className="card kpi"><span className="muted">GST</span><b>{inr(b.gst)}</b></div>
            <div className="card kpi"><span className="muted">Contingency {b.contingency_pct}%</span><b>{inr(b.contingency)}</b></div>
            <div className="card kpi" style={{ borderColor: "var(--accent)" }}><span className="muted">Total estimated project cost</span><b>{inr(b.total)}</b></div>
          </div>
          {b.missing_rates.length > 0 && <div className="error">No rate for: {b.missing_rates.join(", ")}</div>}
          <div className="card">
            <div className="seg noprint" style={{ marginBottom: 10 }}>{VIEWS.map(([v, l]) => <button key={v} className={view === v ? "on" : ""} onClick={() => setView(v)}>{l}</button>)}</div>
            <table>
              <thead><tr><th>Head</th><th style={{ width: "28%" }}></th><th className="num">Material</th><th className="num">Installation</th><th className="num">GST</th><th className="num">Contingency</th><th className="num">Total</th><th className="num">Share</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td>{r.label}</td><td><div className="bar" style={{ width: `${(100 * r.total) / max}%` }} /></td>
                    <td className="num">{inr(r.material)}</td><td className="num">{inr(r.install)}</td><td className="num">{inr(r.gst)}</td>
                    <td className="num">{inr(r.contingency)}</td><td className="num"><b>{inr(r.total)}</b></td>
                    <td className="num">{b.total ? ((100 * r.total) / b.total).toFixed(1) : 0}%</td>
                  </tr>
                ))}
                <tr className="tot"><td>Total</td><td></td><td className="num">{inr(b.material)}</td><td className="num">{inr(b.install)}</td><td className="num">{inr(b.gst)}</td>
                  <td className="num">{inr(b.contingency)}</td><td className="num">{inr(b.total)}</td><td className="num">100%</td></tr>
              </tbody>
            </table>
            {view === "by_floor" && <div className="muted small" style={{ marginTop: 6 }}>“Common” holds project-wide lines (core LIU, services without a location, manual items).</div>}
          </div>
        </>
      )}
    </Shell>
  );
}
