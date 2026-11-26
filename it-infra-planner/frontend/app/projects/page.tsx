"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import ProjectForm from "@/components/ProjectForm";
import { api, Project } from "@/lib/api";

function Projects() {
  const router = useRouter();
  const params = useSearchParams();
  const [list, setList] = useState<Project[] | null>(null);
  const [showNew, setShowNew] = useState(params.get("new") === "1");
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  const load = () => api.projects().then(setList).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const shown = (list || []).filter((p) => `${p.name} ${p.client} ${p.location}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Shell>
      <div className="head">
        <div><h1>Projects</h1><div className="muted">Each project holds buildings → floors → layouts.</div></div>
        {!showNew && <button className="primary" onClick={() => setShowNew(true)}>New project</button>}
      </div>
      {err && <div className="error">{err}</div>}
      {showNew && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>New project</h2>
          <ProjectForm submitLabel="Create project" onCancel={() => setShowNew(false)}
            onSubmit={async (f) => { const p = await api.createProject(f); router.push(`/projects/${p.id}`); }} />
        </div>
      )}
      <div className="card">
        <div className="row" style={{ marginBottom: 10 }}>
          <input placeholder="Search projects, clients, locations" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 340 }} />
        </div>
        {list && shown.length === 0 && <div className="empty">{list.length ? "No match." : "No projects yet."}</div>}
        {shown.length > 0 && (
          <table>
            <thead><tr><th>Project</th><th>Client</th><th>Location</th><th className="num">Bldgs</th><th className="num">Floors</th><th>Phase</th><th>Status</th><th className="num">Layouts</th><th></th></tr></thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id}>
                  <td><Link href={`/projects/${p.id}`}>{p.name}</Link></td><td>{p.client}</td><td>{p.location}</td>
                  <td className="num">{p.num_buildings}</td><td className="num">{p.num_floors}</td>
                  <td>{p.phase}</td><td><span className="badge">{p.status}</span></td><td className="num">{p.layout_count}</td>
                  <td><button className="ghost danger" onClick={async () => {
                    if (!confirm(`Delete project "${p.name}" with all its layouts and equipment? This cannot be undone.`)) return;
                    await api.deleteProject(p.id); load();
                  }}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Shell>
  );
}

export default function Page() { return <Suspense><Projects /></Suspense>; }
