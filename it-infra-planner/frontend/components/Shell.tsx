"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV: { href?: string; label: string; phase?: number }[] = [
  { href: "/", label: "Dashboard" },
  { href: "/projects", label: "Projects" },
  { href: "/drawings", label: "Drawing Manager" },
  { href: "/catalogue", label: "Equipment Library" },
  { href: "/go/quantities", label: "Quantities" },
  { href: "/go/ports", label: "Port Matrix" },
  { href: "/go/boq", label: "BOQ" },
  { href: "/go/budget", label: "IT Budget" },
  { href: "/go/reports", label: "Reports" },
  { href: "/go/settings", label: "Settings" },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">IT Infra Planner<span>Layout · Port Matrix · BOQ</span></div>
        <nav className="nav">
          {NAV.map((n) =>
            n.href ? (
              <Link key={n.label} href={n.href}
                className={(n.href === "/" ? path === "/" : path.startsWith(n.href) || (n.href.startsWith("/go/") && path.endsWith("/" + n.href.slice(4)))) ? "on" : ""}>
                {n.label}
              </Link>
            ) : (
              <span key={n.label} className="soon" title={`Arrives in Phase ${n.phase}`}>
                {n.label} <em>Ph {n.phase}</em>
              </span>
            ),
          )}
        </nav>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
