import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the tracing root to this folder (see original template comment).
  outputFileTracingRoot: __dirname,
  // Optional separate build dir, so a `next dev` (e.g. the Scene Editor) can
  // run next to a `next start` that serves `.next`. Unset = `.next`.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  // Next 15 blocks cross-origin requests to dev-only assets; a headset
  // loading the dev server via LAN IP or tunnel host needs to be allowed.
  allowedDevOrigins: (process.env.ALLOWED_DEV_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};

export default nextConfig;
