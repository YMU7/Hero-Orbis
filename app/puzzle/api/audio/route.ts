import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { dataDir } from "../../../lib/sceneData/serverStore";

// /puzzle/api/audio — recorded sounds that replace the built-in synth ones.
// Files live in data/puzzle-audio/<sound id>.<mp3|ogg|wav|m4a> (read-only
// here; drop files in the folder by hand). Served by ./[file]/route.ts, since
// `next start` only serves public/ files that existed at build time.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const AUDIO_EXT = /\.(mp3|ogg|wav|m4a)$/i;
const audioDir = () => path.join(dataDir(), "puzzle-audio");

export async function GET() {
  let names: string[] = [];
  try {
    names = await fs.readdir(audioDir());
  } catch {
    /* folder missing → no files */
  }
  const files = names
    .filter((n) => AUDIO_EXT.test(n) && /^[a-z0-9-]+\.[a-z0-9]+$/i.test(n))
    .map((n) => ({ id: n.replace(AUDIO_EXT, "").toLowerCase(), file: n, url: `/puzzle/api/audio/${encodeURIComponent(n)}` }));
  return NextResponse.json({ files }, { headers: { "Cache-Control": "no-store" } });
}
