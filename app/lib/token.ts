"use client";

// Session-scoped JWT resolver, moved verbatim out of ViskoOrbisStableApp.tsx so
// the reference app (/) and the XR MVP (/mvp) share ONE module-scope memo.
//
// The token is memoized in module scope until shortly before it expires, and
// the fetch itself is `no-store`. Reuse is REQUIRED: a session-scoped token
// only acts on sessions it created, so every hop of one session must present
// the SAME JWT (otherwise: 403 "...sessions.bind").
//
// Known edge this does not cover: a session created just before the memoized
// token expires is orphaned at the re-mint. Fixing that requires re-minting
// with `authorization_details.resources.sessions.bind` naming the live session.
const TOKEN_REFRESH_SKEW_MS = 60_000;
let cachedToken: { jwt: string; expiresAtMs: number } | null = null;
let inflightToken: Promise<string> | null = null;

export async function fetchToken(): Promise<string> {
  if (
    cachedToken &&
    Date.now() < cachedToken.expiresAtMs - TOKEN_REFRESH_SKEW_MS
  ) {
    return cachedToken.jwt;
  }
  // Coalesce the parallel hops the SDK fires at connect time into one mint.
  if (inflightToken) return inflightToken;
  inflightToken = (async () => {
    try {
      const r = await fetch("/api/reactor/token", { cache: "no-store" });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Token fetch failed: ${r.status}`);
      }
      const { jwt, expires_at } = (await r.json()) as {
        jwt: string;
        expires_at: number;
      };
      cachedToken = { jwt, expiresAtMs: expires_at * 1000 };
      return jwt;
    } finally {
      inflightToken = null;
    }
  })();
  return inflightToken;
}
