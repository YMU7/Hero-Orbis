import { NextResponse, type NextRequest } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { dataDir } from "../../../../lib/sceneData/serverStore";

// GET /puzzle/api/audio/<file> — one file from data/puzzle-audio/.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TYPES: Record<string, string> = { mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", m4a: "audio/mp4" };

export async function GET(_req: NextRequest, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const m = /^([a-z0-9-]+)\.(mp3|ogg|wav|m4a)$/i.exec(file);
  if (!m) return NextResponse.json({ error: "bad name" }, { status: 400 });
  try {
    const buf = await fs.readFile(path.join(dataDir(), "puzzle-audio", file));
    return new NextResponse(new Uint8Array(buf), {
      headers: { "Content-Type": TYPES[m[2].toLowerCase()], "Cache-Control": "no-cache" },
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
