"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { api, Project } from "@/lib/api";

export default function Drawings() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api.projects().then((ps) => Promise.all(ps.map((p) => api.project(p.id)))).then(setProjects).catch((e) => setErr(e.message));
  }, []);
  const rows = (projects || []).flatMap((p) => (p.buildings || []).flatMap((b) => b.floors.flatMap((f) =>
    f.layouts.map((l) => ({ p, b, f, l })))));
  return (
    <Shell>
      <div className="head"><div><h1>Drawing Manager</h1><div className="muted">All layouts across projects. Upload new ones from a project&apos;s floor.</div></div></div>
      {err && <div className="error">{err}</div>}
      <div className="card">
        {projects && rows.length === 0 && <div className="empty">No layouts uploaded yet. Open a <Link href="/projects">project</Link> and upload to a floor.</div>}
        {rows.length > 0 && (
          <table>
            <thead><tr><th>Layout</th><th>Project</th><th>Building</th><th>Floor</th><th>Type</th><th>Scale</th><th className="num">Items</th><th>Updated</th></tr></thead>
            <tbody>
              {rows.map(({ p, b, f, l }) => (
                <tr key={l.id}>
                  <td><Link href={`/editor/${l.id}`}>{l.name}</Link></td>
                  <td><Link href={`/projects/${p.id}`}>{p.name}</Link></td>
                  <td>{b.name}</td><td>{f.name}</td><td>{l.file_type.toUpperCase()}</td>
                  <td>{l.scale_m_per_px ? `${(1 / l.scale_m_per_px).toFixed(1)} px/m` : <span className="badge warn">not set</span>}</td>
                  <td className="num">{l.placements}</td><td className="small muted">{new Date(l.updated_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Shell>
  );
}
