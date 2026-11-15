import { NextResponse, type NextRequest } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { dataDir } from "../../../lib/sceneData/serverStore";
import { defaultStyle, parseStyle } from "../../lib/style";

// /puzzle/api/style — the user's chosen painting look (colour grade + prompt
// parts) from the panel's Style tuner.
//   GET  → saved style, or defaults ({ saved: false })
//   POST → validate + save data/puzzle-style.json, plus a timestamped copy in
//          data/puzzle-style-history/ (so the evolution of choices is kept)
// Bodies are validated/clamped by parseStyle (bounded numbers, ≤2000-char
// strings). Writable through the tunnel too, so the panel works from the
// headset's 2D page; the content only ever feeds this test's own prompts.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };
const file = () => path.join(dataDir(), "puzzle-style.json");
const historyDir = () => path.join(dataDir(), "puzzle-style-history");

export async function GET() {
  try {
    const txt = await fs.readFile(file(), "utf8");
    return NextResponse.json({ saved: true, style: parseStyle(JSON.parse(txt)) }, { headers: NO_STORE });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return NextResponse.json({ saved: false, style: defaultStyle() }, { headers: NO_STORE });
    return NextResponse.json({ error: (e as Error).message }, { status: 500, headers: NO_STORE });
  }
}

export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();
    if (raw.length > 32_000) return NextResponse.json({ error: "too large" }, { status: 413, headers: NO_STORE });
    const style = parseStyle(JSON.parse(raw));
    style.savedAt = new Date().toISOString();
    const body = JSON.stringify(style, null, 2) + "\n";
    await fs.mkdir(historyDir(), { recursive: true });
    const tmp = `${file()}.tmp`;
    await fs.writeFile(tmp, body, "utf8");
    await fs.rename(tmp, file());
    await fs.writeFile(path.join(historyDir(), `style-${style.savedAt.replace(/[:.]/g, "-")}.json`), body, "utf8");
    return NextResponse.json({ saved: true, style }, { headers: NO_STORE });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400, headers: NO_STORE });
  }
}
