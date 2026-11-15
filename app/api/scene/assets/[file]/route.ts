import { NextResponse } from "next/server";
import { readAsset } from "../../../../lib/sceneData/serverStore";

// GET /api/scene/assets/<file> — serves an uploaded GLB/GLTF to the editor
// AND to /mvp (always on). Served from data/scene-assets, not public/,
// because `next start` only serves public files that existed at build time.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const buf = await readAsset(decodeURIComponent(file));
  if (!buf) return NextResponse.json({ error: "not found" }, { status: 404 });
  const type = file.toLowerCase().endsWith(".gltf") ? "model/gltf+json" : "model/gltf-binary";
  return new NextResponse(new Uint8Array(buf), {
    headers: { "Content-Type": type, "Cache-Control": "no-cache", "Content-Length": String(buf.length) },
  });
}
