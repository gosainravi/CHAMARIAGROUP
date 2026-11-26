"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Shell from "@/components/Shell";
import ProjectForm from "@/components/ProjectForm";
import { api, FloorT, Project } from "@/lib/api";

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.dxf,.dwg";

function FloorRow({ f, onProject, onError }: { f: FloorT; onProject: (p: Project) => void; onError: (m: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState("");
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      setBusy(`Uploading ${file.name}…`);
      try { onProject((await api.upload(f.id, file, "")).project); }
      catch (e) { onError(`${file.name}: ${(e as Error).message}`); }
    }
    setBusy("");
    if (input.current) input.current.value = "";
  };
  return (
    <div className="flr" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files); }}>
      <div className="row">
        <b>{f.name}</b> <span className="code">{f.code}</span>
        <span className="muted small">{f.layouts.length} layout{f.layouts.length === 1 ? "" : "s"}</span>
        <span style={{ flex: 1 }} />
        <button onClick={() => input.current?.click()} disabled={!!busy}>Upload layout</button>
        <button className="ghost" onClick={async () => {
          const name = prompt("Floor name", f.name); if (!name) return;
          const code = prompt("Floor code (used in equipment IDs)", f.code) || f.code;
          try { onProject(await api.patchFloor(f.id, name, code)); } catch (e) { onError((e as Error).message); }
        }}>Rename</button>
        <button className="ghost danger" onClick={async () => {
          if (!confirm(`Delete ${f.name} and its ${f.layouts.length} layout(s)? This cannot be undone.`)) return;
          try { onProject(await api.deleteFloor(f.id)); } catch (e) { onError((e as Error).message); }
        }}>Delete</button>
        <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={(e) => upload(e.target.files)} />
      </div>
      {busy && <div className="muted small">{busy}</div>}
      {f.layouts.length === 0 && !busy && <div className="muted small" style={{ marginTop: 6 }}>Drop a PDF, JPG, PNG, DXF or DWG here, or use Upload layout.</div>}
      <div className="layouts">
        {f.layouts.map((l) => (
          <div className="lcard" key={l.id}>
            <Link href={`/editor/${l.id}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={api.imageUrl(l.id)} alt={l.name} loading="lazy" />
            </Link>
            <div>
              <Link href={`/editor/${l.id}`}><b>{l.name}</b></Link>
              <div className="muted small">{l.file_type.toUpperCase()} · {l.placements} items · {l.scale_m_per_px ? "scaled" : <span className="badge warn">no scale</span>}</div>
              <div className="row" style={{ marginTop: 4 }}>
                <Link className="btn" href={`/editor/${l.id}`}>Open editor</Link>
                <button className="ghost danger" onClick={async () => {
                  if (!confirm(`Delete layout "${l.name}" and its ${l.placements} placed items? This cannot be undone.`)) return;
                  try { await api.deleteLayout(l.id); onProject(await api.project(Number(location.pathname.split("/").pop()))); }
                  catch (e) { onError((e as Error).message); }
                }}>Delete</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const [p, setP] = useState<Project | null>(null);
  const [edit, setEdit] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { api.project(Number(id)).then(setP).catch((e) => setErr(e.message)); }, [id]);
  if (!p) return <Shell>{err ? <div className="error">{err}</div> : <div className="muted">Loading…</div>}</Shell>;
  return (
    <Shell>
      <div className="head">
        <div>
          <div className="small"><Link href="/projects">Projects</Link> /</div>
          <h1>{p.name}</h1>
          <div className="muted">{[p.client, p.location].filter(Boolean).join(" · ")} · {p.phase} · <span className="badge">{p.status}</span></div>
          {p.description && <div style={{ marginTop: 4 }}>{p.description}</div>}
        </div>
        <div className="row">
          <button onClick={() => setEdit(!edit)}>{edit ? "Close" : "Edit details"}</button>
          <button onClick={async () => {
            const name = prompt("New building name", `Building ${(p.buildings?.length || 0) + 1}`); if (!name) return;
            const code = prompt("Building code (used in equipment IDs)", `B${(p.buildings?.length || 0) + 1}`) || undefined;
            try { setP(await api.addBuilding(p.id, name, code)); } catch (e) { setErr((e as Error).message); }
          }}>Add building</button>
        </div>
      </div>
      {err && <div className="error" onClick={() => setErr("")}>{err} <span className="small">(click to dismiss)</span></div>}
      {edit && (
        <div className="card" style={{ marginBottom: 16 }}>
          <ProjectForm initial={p} submitLabel="Save" onCancel={() => setEdit(false)}
            onSubmit={async (f) => { setP(await api.patchProject(p.id, f)); setEdit(false); }} />
          <div className="muted small">Raising building/floor counts adds new ones; lowering them never deletes — delete floors below.</div>
        </div>
      )}
      <div className="tree">
        {p.buildings?.map((b) => (
          <section className="bld" key={b.id}>
            <header>
              <h2 style={{ margin: 0 }}>{b.name}</h2> <span className="code">{b.code}</span>
              <span style={{ flex: 1 }} />
              <button onClick={async () => {
                const name = prompt("Floor name", ""); if (name === null) return;
                const code = prompt("Floor code (e.g. GF, FF, SF, 3F)", "") || undefined;
                try { setP(await api.addFloor(b.id, name, code)); } catch (e) { setErr((e as Error).message); }
              }}>Add floor</button>
              <button className="ghost" onClick={async () => {
                const name = prompt("Building name", b.name); if (!name) return;
                const code = prompt("Building code", b.code) || b.code;
                try { setP(await api.patchBuilding(b.id, name, code)); } catch (e) { setErr((e as Error).message); }
              }}>Rename</button>
              <button className="ghost danger" onClick={async () => {
                if (!confirm(`Delete ${b.name} with all floors and layouts? This cannot be undone.`)) return;
                try { setP(await api.deleteBuilding(b.id)); } catch (e) { setErr((e as Error).message); }
              }}>Delete</button>
            </header>
            {b.floors.map((f) => <FloorRow key={f.id} f={f} onProject={setP} onError={setErr} />)}
          </section>
        ))}
      </div>
    </Shell>
  );
}
