import { RoomsApp } from "./RoomsApp";

// /rooms — six-room Orbis visual-style benchmark (Meta Quest 3 WebXR).
// Server Component: only reports whether a key is configured (never sends it).
export const dynamic = "force-dynamic";

export default function RoomsPage() {
  return <RoomsApp hasKey={!!process.env.REACTOR_API_KEY} />;
}
