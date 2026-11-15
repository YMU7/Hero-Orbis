import { NextResponse, type NextRequest } from "next/server";
import { editorEnabled, listAssets, saveAsset } from "../../../lib/sceneData/serverStore";
import { assetUrl } from "../../../lib/sceneData/types";

// GET  /api/scene/assets → uploaded asset list (editor only)
// POST /api/scene/assets → multipart upload, field "file" (.glb, or a
//      self-contained .gltf with embedded buffers/images)
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 150 * 1024 * 1024;

export async function GET() {
  if (!editorEnabled()) return NextResponse.json({ error: "scene editor disabled" }, { status: 403 });
  const files = await listAssets();
  return NextResponse.json(files.map((f) => ({ ...f, url: assetUrl(f.file) })), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  if (!editorEnabled()) return NextResponse.json({ error: "scene editor disabled" }, { status: 403 });
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "missing file" }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "file too large (150 MB max)" }, { status: 413 });
    const name = await saveAsset(file.name, new Uint8Array(await file.arrayBuffer()));
    return NextResponse.json({ file: name, url: assetUrl(name), bytes: file.size });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
