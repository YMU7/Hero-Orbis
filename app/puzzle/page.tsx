import { PuzzleApp } from "./PuzzleApp";

// /puzzle — "Draw a sword" interaction test (Meta Quest 3 WebXR + desktop).
// Server Component: only reports whether a key is configured (never sends it).
// Defaults to MOCK; live Orbis needs ?mode=live or the panel toggle + Connect.
export const dynamic = "force-dynamic";

export default function PuzzlePage() {
  return <PuzzleApp hasKey={!!process.env.REACTOR_API_KEY} />;
}
