"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { api, Project } from "@/lib/api";

export default function Dashboard() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { api.projects().then(setProjects).catch((e) => setErr(e.message)); }, []);
  const sum = (k: "layout_count" | "placement_count") => (projects || []).reduce((a, p) => a + (p[k] || 0), 0);
  return (
    <Shell>
      <div className="head">
        <div><h1>Dashboard</h1><div className="muted">Plan equipment on layouts, then generate the port matrix, BOQ and budget.</div></div>
        <Link className="btn primary" href="/projects?new=1">New project</Link>
      </div>
      {err && <div className="error">Cannot reach the API: {err}. Is the backend running on port 8000?</div>}
      <div className="grid kpis">
        <div className="card kpi"><span className="muted">Projects</span><b>{projects?.length ?? "–"}</b></div>
        <div className="card kpi"><span className="muted">Layouts</span><b>{projects ? sum("layout_count") : "–"}</b></div>
        <div className="card kpi"><span className="muted">Equipment placed</span><b>{projects ? sum("placement_count") : "–"}</b></div>
      </div>
      <div className="card">
        <h2>Recent projects</h2>
        {projects && projects.length === 0 && <div className="empty">No projects yet. <Link href="/projects?new=1">Create the first one</Link>.</div>}
        {projects && projects.length > 0 && (
          <table>
            <thead><tr><th>Project</th><th>Client</th><th>Phase</th><th>Status</th><th className="num">Layouts</th><th className="num">Equipment</th></tr></thead>
            <tbody>
              {projects.slice(0, 8).map((p) => (
                <tr key={p.id}>
                  <td><Link href={`/projects/${p.id}`}>{p.name}</Link></td><td>{p.client}</td>
                  <td>{p.phase}</td><td><span className="badge">{p.status}</span></td>
                  <td className="num">{p.layout_count}</td><td className="num">{p.placement_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Shell>
  );
}
