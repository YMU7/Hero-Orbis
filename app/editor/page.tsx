import { notFound } from "next/navigation";
import { editorEnabled } from "../lib/sceneData/serverStore";
import { EditorApp } from "./EditorApp";

// /editor — desktop-only Scene Editor for the shared /mvp environment.
// Available under `next dev`; in a production build only when the server
// runs with ENABLE_SCENE_EDITOR=1 (otherwise 404, and the write APIs 403).
export const dynamic = "force-dynamic";

export default function EditorPage() {
  if (!editorEnabled()) notFound();
  return <EditorApp />;
}
