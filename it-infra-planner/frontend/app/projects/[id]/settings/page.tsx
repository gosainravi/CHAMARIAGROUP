"use client";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import ProjectTabs from "@/components/ProjectTabs";
import { api2 } from "@/lib/api";

const FIELDS: [string, string, string][] = [
  ["Port matrix", "switch_ports", "Usable copper ports per access switch"],
  ["Port matrix", "pp_ports", "Ports per patch panel"],
  ["Port matrix", "spare_pct", "Spare switch ports %"],
  ["Port matrix", "max_run_m", "Maximum Cat6 run (m) before warning"],
  ["Port matrix", "switch_poe_w", "Switch PoE budget (W)"],
  ["Cabling", "wastage_pct", "Cable wastage %"],
  ["Cabling", "roll_m", "Cat6 roll length (m)"],
  ["Cabling", "service_loop_m", "Service loop per point (m)"],
  ["Cabling", "vertical_drop_m", "Vertical drop per point (m)"],
  ["Cabling", "floor_height_m", "Floor-to-floor height (m)"],
  ["Cabling", "default_run_m", "Run per point when layout has no scale (m)"],
  ["Cabling", "default_fiber_m", "Fibre link length when racks are on different layouts (m)"],
  ["Cabling", "fiber_cores", "Fibre cores per link"],
  ["CCTV", "recording_days", "Recording days"],
  ["CCTV", "camera_mbps", "Bitrate per camera (Mbps)"],
  ["CCTV", "hdd_tb", "HDD size (TB)"],
  ["CCTV", "nvr_channels", "Channels per NVR (when no NVR is placed)"],
  ["Budget", "contingency_pct", "Contingency %"],
];

export default function Settings() {
  const id = Number(useParams<{ id: string }>().id);
  const [v, setV] = useState<Record<string, unknown> | null>(null);
  const [d, setD] = useState<Record<string, unknown>>({});
  const [racks, setRacks] = useState<{ id: number; code: string; model: string }[]>([]);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => { api2.settings(id).then((r) => { setV(r.values); setD(r.defaults); setRacks(r.racks); }).catch((e) => setErr(e.message)); }, [id]);
  if (!v) return <Shell><ProjectTabs id={id} title="Settings" />{err ? <div className="error">{err}</div> : <div className="muted">Loading…</div>}</Shell>;
  const vlan = (v.vlan || {}) as Record<string, number>;
  return (
    <Shell>
      <ProjectTabs id={id} title="Calculation rules" actions={<>
        <button onClick={() => { setV({ ...d }); setMsg("Defaults loaded — Save to apply."); }}>Load defaults</button>
        <button className="primary" onClick={async () => {
          setErr(""); setMsg("");
          try { const r = await api2.saveSettings(id, v); setV(r.values); setMsg("Saved. Quantities, port matrix, BOQ and budget now use these rules."); }
          catch (e) { setErr((e as Error).message); }
        }}>Save</button>
      </>} />
      {err && <div className="error">{err}</div>}
      {msg && <div className="card small" style={{ marginBottom: 10 }}>{msg}</div>}
      {["Port matrix", "Cabling", "CCTV", "Budget"].map((g) => (
        <div className="card" key={g} style={{ marginBottom: 12 }}>
          <h2>{g}</h2>
          <div className="form">
            {FIELDS.filter((f) => f[0] === g).map(([, k, label]) => (
              <label key={k}>{label}<input type="number" step="any" min={0} value={String(v[k] ?? "")} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
                {String(v[k]) !== String(d[k]) && <span className="small muted">default {String(d[k])}</span>}</label>
            ))}
            {g === "Port matrix" && (
              <label>Core rack (fibre backbone hub)
                <select value={String(v.core_rack_id ?? "")} onChange={(e) => setV({ ...v, core_rack_id: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">Auto (first 42U rack)</option>
                  {racks.map((r) => <option key={r.id} value={r.id}>{r.code} – {r.model}</option>)}
                </select></label>
            )}
            {g === "Cabling" && (
              <label className="row" style={{ color: "var(--text)" }}><input type="checkbox" style={{ width: "auto" }} checked={!!v.wifi_cat6a} onChange={(e) => setV({ ...v, wifi_cat6a: e.target.checked })} /> Wi-Fi points on Cat6A</label>
            )}
          </div>
          {g === "Port matrix" && (
            <>
              <h3 style={{ marginTop: 8 }}>VLAN per point type</h3>
              <div className="form">
                {Object.entries(vlan).map(([t, n]) => (
                  <label key={t}>{t}<input type="number" min={1} max={4094} value={n} onChange={(e) => setV({ ...v, vlan: { ...vlan, [t]: Number(e.target.value) } })} /></label>
                ))}
              </div>
            </>
          )}
        </div>
      ))}
    </Shell>
  );
}
