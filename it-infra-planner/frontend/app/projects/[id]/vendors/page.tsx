"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import ProjectTabs from "@/components/ProjectTabs";
import { api3, inr, VendorCompare } from "@/lib/api";

export default function Vendors() {
  const id = Number(useParams<{ id: string }>().id);
  const [c, setC] = useState<VendorCompare | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => { api3.compare(id).then(setC).catch((e) => setErr(e.message)); }, [id]);
  const apply = async (v: string) => {
    if (!confirm(`Set the catalogue vendor rate to ${v === "cheapest" ? "the cheapest quote" : `${v}'s quote`} for every item quoted here? This changes the Equipment Library, so other projects using these items will use the new rates too.`)) return;
    try { const r = await api3.apply(id, v); setC(r); setMsg(`Updated ${r.updated_items} catalogue item(s). BOQ and budget now use these rates.`); }
    catch (e) { setErr((e as Error).message); }
  };
  return (
    <Shell>
      <ProjectTabs id={id} title="Vendor comparison" />
      {err && <div className="error">{err}</div>}
      {msg && <div className="card small" style={{ marginBottom: 10 }}>{msg}</div>}
      {!c ? <div className="muted">Calculating…</div> : c.vendors.length === 0 ? (
        <div className="card empty">No vendor quotes yet for items in this BOQ. Add quotes per model in the <Link href="/catalogue">Equipment Library</Link> (“Quotes” on each row), then compare them here.</div>
      ) : (
        <>
          <div className="grid kpis">
            <div className="card kpi"><span className="muted">Current material total</span><b>{inr(c.current_total)}</b></div>
            {c.vendors.map((v) => (
              <div className="card kpi" key={v}><span className="muted">{v}</span><b>{inr(c.totals[v])}</b>
                <span className="small muted">quoted {c.covered[v]} of {c.lines_total} lines</span>
                <button style={{ marginTop: 6 }} onClick={() => apply(v)}>Use {v} rates</button></div>
            ))}
            <div className="card kpi" style={{ borderColor: "var(--ok)" }}><span className="muted">Cheapest per line</span><b>{inr(c.best_total)}</b>
              <span className="small muted">saves {inr(c.current_total - c.best_total)}</span>
              <button className="primary" style={{ marginTop: 6 }} onClick={() => apply("cheapest")}>Use cheapest</button></div>
          </div>
          <div className="muted small" style={{ marginBottom: 8 }}>Totals are ex-GST material only. A vendor with no quote for a line is counted at the current rate.</div>
          <div className="card scroll">
            <table>
              <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Current rate</th>{c.vendors.map((v) => <th key={v} className="num">{v}</th>)}<th>Best</th></tr></thead>
              <tbody>
                {c.rows.map((r) => (
                  <tr key={r.key}>
                    <td>{r.description}</td><td className="num">{r.qty} {r.uom}</td>
                    <td className="num">{inr(r.current_rate)} <span className="muted small">{r.rate_source}</span></td>
                    {c.vendors.map((v) => (
                      <td key={v} className="num" style={r.best_vendor === v ? { color: "var(--ok)", fontWeight: 700 } : undefined}>{r.rates[v] != null ? inr(r.rates[v]) : "–"}</td>
                    ))}
                    <td>{r.best_vendor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Shell>
  );
}
