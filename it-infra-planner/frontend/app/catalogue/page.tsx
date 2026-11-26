"use client";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { api, api3, Category, inr, Item, Quote } from "@/lib/api";

const FIELDS: { k: keyof Item; label: string; num?: boolean; w?: number }[] = [
  { k: "manufacturer", label: "Manufacturer", w: 110 }, { k: "model", label: "Model", w: 130 },
  { k: "description", label: "Description", w: 220 }, { k: "specs", label: "Specifications", w: 160 },
  { k: "uom", label: "UOM", w: 60 }, { k: "indicative_rate", label: "Indicative ₹", num: true, w: 95 },
  { k: "vendor_rate", label: "Vendor ₹", num: true, w: 95 }, { k: "gst_pct", label: "GST %", num: true, w: 60 },
  { k: "install_rate", label: "Install ₹", num: true, w: 85 }, { k: "warranty", label: "Warranty", w: 80 },
  { k: "datasheet_url", label: "Datasheet URL", w: 140 },
];

function Quotes({ item, cols }: { item: Item; cols: number }) {
  const [qs, setQs] = useState<Quote[] | null>(null);
  const [f, setF] = useState({ vendor: "", rate: "", quote_ref: "", quote_date: "" });
  const [err, setErr] = useState("");
  useEffect(() => { api3.quotes(item.id).then(setQs); }, [item.id]);
  return (
    <tr><td colSpan={cols} style={{ background: "var(--bg)" }}>
      <b className="small">Vendor quotes for {item.manufacturer} {item.model}</b> <span className="muted small">(ex-GST; compare them per project under Vendors)</span>
      <table style={{ maxWidth: 640, margin: "4px 0" }}><tbody>
        {(qs || []).map((q) => (
          <tr key={q.id}><td>{q.vendor}</td><td className="num">{inr(q.rate)}</td><td className="small">{q.quote_ref}</td><td className="small">{q.quote_date}</td>
            <td><button className="ghost danger" onClick={async () => setQs(await api3.deleteQuote(q.id))}>✕</button></td></tr>
        ))}
        <tr>
          <td><input placeholder="Vendor" value={f.vendor} onChange={(e) => setF({ ...f, vendor: e.target.value })} /></td>
          <td><input placeholder="Rate ₹" type="number" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} style={{ width: 100 }} /></td>
          <td><input placeholder="Quote ref" value={f.quote_ref} onChange={(e) => setF({ ...f, quote_ref: e.target.value })} /></td>
          <td><input type="date" value={f.quote_date} onChange={(e) => setF({ ...f, quote_date: e.target.value })} /></td>
          <td><button onClick={async () => {
            if (!f.vendor.trim() || f.rate === "" || Number(f.rate) < 0) { setErr("Enter a vendor and a rate"); return; }
            try { setQs(await api3.addQuote(item.id, { ...f, rate: Number(f.rate) })); setF({ vendor: "", rate: "", quote_ref: "", quote_date: "" }); setErr(""); }
            catch (e) { setErr((e as Error).message); }
          }}>Add</button></td>
        </tr>
      </tbody></table>
      {err && <span className="issue-err small">{err}</span>}
    </td></tr>
  );
}

function Row({ item, onSaved, onDeleted }: { item: Item; onSaved: (i: Item) => void; onDeleted: (msg?: string) => void }) {
  const [d, setD] = useState<Item>(item);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const dirty = FIELDS.some((f) => d[f.k] !== item[f.k]);
  return (
    <>
    <tr style={item.is_active ? undefined : { opacity: 0.5 }}>
      {FIELDS.map((f) => (
        <td key={f.k} className={f.num ? "num" : ""}>
          <input style={{ width: f.w }} type={f.num ? "number" : "text"} step="any"
            value={(d[f.k] ?? "") as string | number}
            onChange={(e) => setD({ ...d, [f.k]: f.num ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value })} />
        </td>
      ))}
      <td>{d.vendor_rate != null ? <span className="badge">vendor</span> : <span className="badge warn">indicative</span>}</td>
      <td style={{ whiteSpace: "nowrap" }}>
        <button className="primary" disabled={!dirty || busy} onClick={async () => {
          setBusy(true);
          try {
            const body: Partial<Item> = {};
            FIELDS.forEach((f) => { (body as Record<string, unknown>)[f.k] = f.num && f.k !== "vendor_rate" ? Number(d[f.k] || 0) : d[f.k]; });
            onSaved(await api.patchItem(item.id, body));
          } finally { setBusy(false); }
        }}>Save</button>{" "}
        {item.is_active ? (
          <button className="ghost danger" onClick={async () => {
            if (!confirm(`Delete ${item.manufacturer} ${item.model}?`)) return;
            const r = await api.deleteItem(item.id);
            onDeleted(r.deactivated ? `${item.model} is used on ${r.used_by} placement(s), so it was hidden from the library instead of deleted.` : undefined);
          }}>Delete</button>
        ) : (
          <button className="ghost" onClick={async () => onSaved(await api.patchItem(item.id, { is_active: true }))}>Restore</button>
        )}{" "}
        <button className={`ghost ${open ? "on" : ""}`} onClick={() => setOpen(!open)}>Quotes</button>
      </td>
    </tr>
    {open && <Quotes item={item} cols={FIELDS.length + 2} />}
    </>
  );
}

export default function CataloguePage() {
  const [cats, setCats] = useState<Category[] | null>(null);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState("");
  const load = () => api.catalogue().then(setCats).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, []);
  const ql = q.toLowerCase();
  const groups = Array.from(new Set((cats || []).map((c) => c.group)));
  const count = (cats || []).reduce((a, c) => a + c.items.length, 0);
  return (
    <Shell>
      <div className="head">
        <div><h1>Equipment Library</h1><div className="muted">{count} models in {cats?.length ?? 0} categories. Rates are ex-GST. A vendor rate overrides the indicative rate in the budget.</div></div>
        <input placeholder="Search make, model, description" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 300 }} />
      </div>
      {msg && <div className="error" onClick={() => setMsg("")}>{msg}</div>}
      {groups.map((g) => (
        <div className="card" key={g} style={{ marginBottom: 14, overflowX: "auto" }}>
          <h2>{g}</h2>
          {(cats || []).filter((c) => c.group === g).map((c) => {
            const items = c.items.filter((i) => !ql || `${c.name} ${i.manufacturer} ${i.model} ${i.description}`.toLowerCase().includes(ql));
            if (ql && !items.length) return null;
            return (
              <div key={c.id} style={{ marginBottom: 14 }}>
                <div className="row" style={{ marginBottom: 6 }}>
                  <span className="sym" style={{ background: c.color }}>{c.symbol}</span>
                  <b>{c.name}</b>
                  <span className="muted small">layer {c.layer}{c.point_type ? ` · ${c.ports_required} × ${c.point_type} point` : ""}</span>
                  <button className="ghost" onClick={async () => {
                    await api.addItem({ category_id: c.id, manufacturer: "New", model: "Model", uom: "Nos." }); load();
                  }}>+ Add model</button>
                </div>
                <table>
                  <thead><tr>{FIELDS.map((f) => <th key={f.k} className={f.num ? "num" : ""}>{f.label}</th>)}<th>Rate used</th><th></th></tr></thead>
                  <tbody>
                    {items.map((i) => (
                      <Row key={i.id} item={i}
                        onSaved={(n) => setCats((cs) => cs!.map((cc) => cc.id === c.id ? { ...cc, items: cc.items.map((x) => x.id === n.id ? n : x) } : cc))}
                        onDeleted={(m) => { if (m) setMsg(m); load(); }} />
                    ))}
                  </tbody>
                </table>
                <div className="muted small" style={{ marginTop: 4 }}>
                  Cheapest: {items.length ? inr(Math.min(...items.map((i) => i.vendor_rate ?? i.indicative_rate))) : "–"}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </Shell>
  );
}
