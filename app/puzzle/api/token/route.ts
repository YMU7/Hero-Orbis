import { NextResponse } from "next/server";

// /puzzle/api/token — same minting as app/api/reactor/token/route.ts, with a
// longer lifetime for a play-test where a player may stay in the room for a
// long time.
//
// Why: a session is bound to the exact JWT that created it. The shared route
// mints 1 h tokens; ~1 min before expiry the client re-mints, and the NEW
// token is not bound to the running session, so later hops (ICE refresh,
// renegotiation) can 403 — i.e. a hidden ~1 h limit on one sitting. 6 h is
// the server's cap. Session budget is raised for automatic reconnects.
const MODEL_NAME = "reactor/visko-orbis-stable";
const MAX_SESSIONS = 20;
const TOKEN_LIFETIME_SECONDS = 6 * 60 * 60;

export async function GET() {
  const apiKey = process.env.REACTOR_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "REACTOR_API_KEY is not set on the server" }, { status: 500 });
  }
  const res = await fetch("https://api.reactor.inc/tokens", {
    method: "POST",
    headers: { "Reactor-API-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      expires_after: TOKEN_LIFETIME_SECONDS,
      authorization_details: [
        {
          type: "session",
          resources: { models: { match: [MODEL_NAME] } },
          constraints: { max_sessions: MAX_SESSIONS },
        },
      ],
    }),
  });
  if (!res.ok) {
    return NextResponse.json({ error: `Reactor /tokens returned ${res.status}` }, { status: 502 });
  }
  const { jwt, expires_at } = (await res.json()) as { jwt: string; expires_at: number };
  return NextResponse.json({ jwt, expires_at }, { headers: { "Cache-Control": "private, no-store" } });
}
