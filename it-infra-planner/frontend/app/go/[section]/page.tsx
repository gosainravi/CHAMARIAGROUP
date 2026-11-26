"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { api, Project } from "@/lib/api";
import { TABS } from "@/components/ProjectTabs";

/** Sidebar entry for project-level screens: jump to the last opened project, or pick one. */
export default function Go() {
  const { section } = useParams<{ section: string }>();
  const router = useRouter();
  const [list, setList] = useState<Project[] | null>(null);
  const label = TABS.find((t) => t.seg === section)?.label ?? section;
  useEffect(() => {
    api.projects().then((ps) => {
      let last: string | null = null;
      try { last = localStorage.getItem("lastProject"); } catch {}
      if (last && ps.some((p) => String(p.id) === last)) router.replace(`/projects/${last}/${section}`);
      else if (ps.length === 1) router.replace(`/projects/${ps[0].id}/${section}`);
      else setList(ps);
    });
  }, [section, router]);
  return (
    <Shell>
      <h1>{label}</h1>
      {!list ? <div className="muted">Opening…</div> : (
        <div className="card">
          <h2>Choose a project</h2>
          {list.length === 0 && <div className="empty">No projects yet. <Link href="/projects?new=1">Create one</Link>.</div>}
          {list.map((p) => <div key={p.id} style={{ padding: "6px 0" }}><Link href={`/projects/${p.id}/${section}`}>{p.name}</Link> <span className="muted small">{p.client}</span></div>)}
        </div>
      )}
    </Shell>
  );
}
