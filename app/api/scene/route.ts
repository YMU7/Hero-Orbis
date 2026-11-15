import { NextResponse, type NextRequest } from "next/server";
import { editorEnabled, readScene, SceneConflictError, writeScene } from "../../lib/sceneData/serverStore";
import { DEFAULT_SCENE_ID } from "../../lib/sceneData/types";

// GET  /api/scene?id=mvp → the shared environment (always on; /mvp reads it)
// POST /api/scene?id=mvp → save from the Scene Editor (dev, or ENABLE_SCENE_EDITOR=1)
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? DEFAULT_SCENE_ID;
  try {
    return NextResponse.json(await readScene(id), { headers: NO_STORE });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400, headers: NO_STORE });
  }
}

export async function POST(req: NextRequest) {
  if (!editorEnabled()) return NextResponse.json({ error: "scene editor disabled" }, { status: 403 });
  const id = req.nextUrl.searchParams.get("id") ?? DEFAULT_SCENE_ID;
  try {
    // Optional optimistic-concurrency check: "X-Scene-Base" = the savedAt the
    // editor loaded ("none" = it loaded a file without one). Absent = no check.
    const base = req.headers.get("x-scene-base");
    const doc = await writeScene(id, await req.json(), base === null ? undefined : base === "none" ? null : base);
    return NextResponse.json(doc, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof SceneConflictError) {
      return NextResponse.json({ error: e.message, current: e.current }, { status: 409, headers: NO_STORE });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 400, headers: NO_STORE });
  }
}
