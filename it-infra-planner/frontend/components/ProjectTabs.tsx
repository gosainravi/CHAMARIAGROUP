"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api, Project } from "@/lib/api";

export const TABS = [
  { seg: "", label: "Layouts" },
  { seg: "quantities", label: "Quantities" },
  { seg: "ports", label: "Port Matrix" },
  { seg: "boq", label: "BOQ" },
  { seg: "budget", label: "IT Budget" },
  { seg: "reports", label: "Reports" },
  { seg: "settings", label: "Settings" },
];

export function useProject(id: number) {
  const [p, setP] = useState<Project | null>(null);
  useEffect(() => {
    api.project(id).then(setP).catch(() => {});
    try { localStorage.setItem("lastProject", String(id)); } catch {}
  }, [id]);
  return p;
}

export default function ProjectTabs({ id, title, actions }: { id: number; title: string; actions?: React.ReactNode }) {
  const path = usePathname();
  const p = useProject(id);
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="small"><Link href="/projects">Projects</Link> / <Link href={`/projects/${id}`}>{p?.name ?? "…"}</Link></div>
      <div className="head" style={{ marginBottom: 8 }}>
        <h1>{title}</h1>
        <div className="row">{actions}</div>
      </div>
      <nav className="tabs">
        {TABS.map((t) => {
          const href = `/projects/${id}${t.seg ? "/" + t.seg : ""}`;
          return <Link key={t.seg} href={href} className={path === href ? "on" : ""}>{t.label}</Link>;
        })}
      </nav>
    </div>
  );
}
