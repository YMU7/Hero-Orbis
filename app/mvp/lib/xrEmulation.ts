"use client";

// DEV-ONLY: emulated Meta Quest 3 via Meta's Immersive Web Emulation Runtime
// (IWER, npm `iwer`, https://meta-quest.github.io/immersive-web-emulation-runtime/).
//
// Opt-in with `?emulate=quest3`. Lets a desktop browser open a real
// `immersive-vr` session (navigator.xr replaced by IWER) so the frame loop,
// controller select path and video texture can be exercised without a
// headset. It is NOT evidence of Quest Browser behaviour — media decoding,
// compositor and rVFC scheduling on the device can differ.
//
// Per IWER's own guidance, it is never installed when native immersive-vr
// is available (i.e. on a real Quest, the param is ignored).

export type EmulationResult = { installed: boolean; note: string };

type IwerDevice = {
  position: { set: (x: number, y: number, z: number) => void };
  installRuntime: (opts?: { forceInstall?: boolean }) => void;
};

export async function installQuestEmulatorIfRequested(): Promise<EmulationResult> {
  const want = new URLSearchParams(window.location.search).get("emulate");
  if (want !== "quest3") return { installed: false, note: "emulation off" };

  const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
  const native = xr ? await xr.isSessionSupported("immersive-vr").catch(() => false) : false;
  if (native) {
    return { installed: false, note: "native immersive-vr present — emulator NOT installed" };
  }

  const { XRDevice, metaQuest3 } = await import("iwer");
  const device = new XRDevice(metaQuest3) as unknown as IwerDevice;
  device.position.set(0, 1.6, 0);
  // Desktop Chromium exposes a native navigator.xr with no devices; IWER
  // skips installation over any native XRSystem unless forced. We only get
  // here after confirming native immersive-vr is NOT supported.
  device.installRuntime({ forceInstall: true });
  // Exposed for scripted tests (controller pose / trigger) in dev only.
  (window as unknown as { __iwer?: unknown }).__iwer = device;
  return { installed: true, note: "IWER metaQuest3 runtime installed (EMULATED, not hardware)" };
}
