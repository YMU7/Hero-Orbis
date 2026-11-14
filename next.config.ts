import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the tracing root to this folder (see original template comment).
  outputFileTracingRoot: __dirname,
  // Next 15 blocks cross-origin requests to dev-only assets; a headset
  // loading the dev server via LAN IP or tunnel host needs to be allowed.
  allowedDevOrigins: (process.env.ALLOWED_DEV_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};

export default nextConfig;
