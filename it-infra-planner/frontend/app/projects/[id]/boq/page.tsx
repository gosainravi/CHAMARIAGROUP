"use client";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Shell from "@/components/Shell";
import ProjectTabs from "@/components/ProjectTabs";
import { api2, Boq, BoqLineT, CompareRow, download, inr } from "@/lib/api";

const SRC: Record<string, string> = { vendor: "badge", manual: "badge", indicative: "badge warn", missing: "badge warn" };

function E({ ln, f, w = 70, num = false, onSave }: { ln: BoqLineT; f: keyof BoqLineT; w?: number; num?: boolean; onSave: (ln: BoqLineT, f: string, v: string) => void }) {
  const v = ln[f] as string | number;
  return (
    <input key={`${ln.key}-${f}-${v}`} defaultValue={v ?? ""} type={num ? "number" : "text"} step="any" style={{ width: w }}
      className={`cell-in ${ln.edited.includes(f as string) ? "edited" : ""}`}
      onBlur={(e) => { if (e.target.value !== String(v ?? "")) onSave(ln, f as string, e.target.value); }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
  );
}

export default function BoqPage() {
  const id = Number(useParams<{ id: string }>().id);
  const [b, setB] = useState<Boq | null>(null);
  const [err, setErr] = useState("");
  const [cmp, setCmp] = useState<{ file: string; imported_rows: number; rows: CompareRow[] } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { api2.boq(id).then(setB).catch((e) => setErr(e.message)); }, [id]);
  const run = async (p: Promise<Boq>) => { try { setB(await p); } catch (e) { setErr((e as Error).message); } };
  const save = (ln: BoqLineT, f: string, v: string) => {
    const num = ["qty", "phase1", "rate", "install_rate", "gst_pct"].includes(f);
    if (num && v.trim() !== "" && (isNaN(Number(v)) || Number(v) < 0)) { setErr(`${f} must be a number ≥ 0`); return; }
    run(api2.editBoq(id, ln.key, { [f]: v.trim() === "" ? null : num ? Number(v) : v }));
  };
  const t = b?.budget;
  return (
    <Shell>
      <ProjectTabs id={id} title="Bill of Quantities" actions={<>
        <button onClick={() => file.current?.click()}>Import & compare Excel BOQ</button>
        <button onClick={() => { if (confirm("Undo all edits to calculated lines? Manual lines stay.")) run(api2.resetBoq(id)); }}>Reset edits</button>
        <button onClick={() => run(api2.addBoq(id, {}))}>+ Add item</button>
        <button className="primary" onClick={() => download(`/api/projects/${id}/boq.xlsx`).catch((e) => setErr(e.message))}>Export Excel</button>
      </>} />
      <input ref={file} type="file" accept=".xlsx" hidden onChange={async (e) => {
        const f = e.target.files?.[0]; if (!f) return;
        try { setCmp(await api2.compareBoq(id, f)); } catch (x) { setErr((x as Error).message); }
        e.target.value = "";
      }} />
      {err && <div className="error" onClick={() => setErr("")}>{err}</div>}
      {b && t && (
        <div className="grid kpis">
          <div className="card kpi"><span className="muted">Material</span><b>{inr(t.material)}</b></div>
          <div className="card kpi"><span className="muted">Installation</span><b>{inr(t.install)}</b></div>
          <div className="card kpi"><span className="muted">GST</span><b>{inr(t.gst)}</b></div>
          <div className="card kpi"><span className="muted">Total incl. {t.contingency_pct}% contingency</span><b>{inr(t.total)}</b>
            <span className="small muted">{t.pct_vendor}% on vendor rates</span></div>
        </div>
      )}
      {cmp && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2 style={{ margin: 0 }}>Comparison with {cmp.file}</h2><button className="ghost" onClick={() => setCmp(null)}>Close</button>
          </div>
          <div className="muted small" style={{ margin: "4px 0 8px" }}>
            {cmp.imported_rows} rows read · {cmp.rows.filter((r) => r.status === "matched").length} matched · {cmp.rows.filter((r) => r.status === "only_imported").length} only in the imported file · {cmp.rows.filter((r) => r.status === "only_calculated").length} only in the calculated BOQ. Matching is by description, so check each match.
          </div>
          <div className="scroll" style={{ maxHeight: 320 }}>
            <table>
              <thead><tr><th>Status</th><th>Imported description</th><th className="num">Imported qty</th><th>Calculated description</th><th className="num">Calculated qty</th><th className="num">Difference</th></tr></thead>
              <tbody>
                {cmp.rows.map((r, i) => (
                  <tr key={i}>
                    <td><span className={r.status === "matched" ? (r.delta ? "badge warn" : "badge") : "badge warn"}>{r.status === "matched" ? `match ${Math.round((r.score || 0) * 100)}%` : r.status === "only_imported" ? "only imported" : "only calculated"}</span></td>
                    <td>{r.imported?.description}</td><td className="num">{r.imported?.qty}</td>
                    <td>{r.calc_description}</td><td className="num">{r.calc_qty}</td>
                    <td className={`num ${r.delta ? "issue-warn" : ""}`}>{r.delta != null ? (r.delta > 0 ? "+" : "") + r.delta : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {!b ? <div className="muted">Calculating…</div> : b.lines.length === 0 ? <div className="card empty">Nothing to price yet. Open a layout in the editor, click <b>Auto-place equipment</b>, accept and <b>Save</b>. The BOQ is then generated here; every cell is editable and <b>Export Excel</b> is at the top right.</div> : (
        <div className="card scroll">
          <table>
            <thead><tr>
              <th>S.No</th><th>Description</th><th>Specifications</th><th>Brand</th><th>Model</th><th>UOM</th>
              <th className="num">Full qty</th><th className="num">Phase 1</th><th className="num">Phase 2</th><th className="num">Unit rate ₹</th><th>Rate</th>
              <th className="num">Install ₹/u</th><th className="num">GST %</th><th className="num">Amount ₹</th><th>Remarks</th><th></th>
            </tr></thead>
            <tbody>
              {b.sections.map((sec) => {
                const ls = b.lines.filter((l) => l.section === sec);
                return [
                  <tr key={sec} className="sec"><td colSpan={16}>{sec}</td></tr>,
                  ...ls.map((ln) => (
                    <tr key={ln.key}>
                      <td>{ln.sn}</td>
                      <td><E ln={ln} f="description" w={250} onSave={save} /></td>
                      <td><E ln={ln} f="specs" w={140} onSave={save} /></td>
                      <td><E ln={ln} f="brand" w={90} onSave={save} /></td>
                      <td><E ln={ln} f="model" w={100} onSave={save} /></td>
                      <td><E ln={ln} f="uom" w={50} onSave={save} /></td>
                      <td className="num"><E ln={ln} f="qty" w={64} num onSave={save} />{ln.calc_qty != null && ln.edited.includes("qty") && <div className="muted small">calc {ln.calc_qty}</div>}</td>
                      <td className="num"><E ln={ln} f="phase1" w={58} num onSave={save} /></td>
                      <td className="num">{ln.phase2}</td>
                      <td className="num"><E ln={ln} f="rate" w={80} num onSave={save} /></td>
                      <td><span className={SRC[ln.rate_source]}>{ln.rate_source}</span></td>
                      <td className="num"><E ln={ln} f="install_rate" w={62} num onSave={save} /></td>
                      <td className="num"><E ln={ln} f="gst_pct" w={44} num onSave={save} /></td>
                      <td className="num" title={`Material ${inr(ln.material)} + install ${inr(ln.install)} + GST ${inr(ln.gst)}`}><b>{inr(ln.total)}</b></td>
                      <td><E ln={ln} f="remarks" w={150} onSave={save} /></td>
                      <td><button className="ghost danger" title={ln.manual ? "Delete line" : "Hide this calculated line (Reset edits brings it back)"}
                        onClick={() => run(api2.deleteBoq(id, ln.key))}>✕</button></td>
                    </tr>
                  )),
                  <tr key={sec + "t"} className="tot"><td></td><td colSpan={12}>Sub-total – {sec}</td><td className="num">{inr(ls.reduce((a, l) => a + l.total, 0))}</td><td colSpan={2}></td></tr>,
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}
