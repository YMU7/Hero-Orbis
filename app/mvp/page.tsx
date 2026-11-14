import { MVPApp } from "./MVPApp";

// /mvp — Meta Quest 3 (Meta Quest Browser) WebXR MVP. Server Component: only checks whether the server
// has REACTOR_API_KEY (never sends it). Without a key the page still renders
// so MOCK mode can exercise Three.js/WebXR on its own.
export const dynamic = "force-dynamic";

export default function MVPPage() {
  return <MVPApp hasKey={!!process.env.REACTOR_API_KEY} />;
}
