"use client";
import dynamic from "next/dynamic";
import { useParams } from "next/navigation";

const Editor = dynamic(() => import("@/components/Editor"), { ssr: false, loading: () => <div className="main muted">Loading editor…</div> });

export default function EditorPage() {
  const { id } = useParams<{ id: string }>();
  return <Editor key={id} layoutId={Number(id)} />;
}
