"use client";

// MOCK video source for Gate B. It is NOT Orbis and says so in every frame.
//
// Instead of an MP4 it animates a canvas and exposes it via
// canvas.captureStream(): the result is a live MediaStream fed into a <video>
// element, the same MediaStream → <video> → VideoTexture path the real
// WebRTC main_video track takes. If the mock moves on the headset plane, the
// bridge works; swapping in the Orbis track changes only the stream.

export type MockScene = "initial" | "rain" | "night";

const SCENE_STYLE: Record<MockScene, { bg: string; fg: string; label: string }> =
  {
    initial: { bg: "#c98a3a", fg: "#fff3d6", label: "SUNNY (mock)" },
    rain: { bg: "#2f5f8a", fg: "#d6ecff", label: "RAIN (mock)" },
    night: { bg: "#151a3a", fg: "#b8c4ff", label: "NIGHT (mock)" },
  };

export type MockSource = {
  stream: MediaStream | null;
  setScene: (s: MockScene) => void;
  /** Optional override for the scene label line (e.g. room + action). null = default. */
  setLabel: (text: string | null) => void;
  stop: () => void;
  error: string | null;
};

export function createMockSource(width = 832, height = 468, fps = 30): MockSource {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  let scene: MockScene = "initial";
  let labelOverride: string | null = null;
  let raf = 0;
  const t0 = performance.now();

  const draw = () => {
    if (!ctx) return;
    const t = (performance.now() - t0) / 1000;
    const st = SCENE_STYLE[scene];
    ctx.fillStyle = st.bg;
    ctx.fillRect(0, 0, width, height);

    // Moving elements: proves frames keep updating on the texture.
    for (let i = 0; i < 6; i++) {
      const x = ((t * 120 + i * 160) % (width + 80)) - 40;
      const y = height * 0.55 + Math.sin(t * 2 + i) * 60;
      ctx.fillStyle = st.fg;
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.arc(x, y, 30, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (scene === "rain") {
      ctx.strokeStyle = "rgba(220,240,255,0.6)";
      for (let i = 0; i < 60; i++) {
        const x = (i * 53 + t * 40) % width;
        const y = (i * 97 + t * 400) % height;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - 4, y + 16);
        ctx.stroke();
      }
    }

    // The unmissable label (brief: mock MUST be visibly labelled MOCK).
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, width, 70);
    ctx.fillStyle = "#ff4d4d";
    ctx.font = "bold 44px sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText("MOCK — NOT LIVE ORBIS", 20, 36);
    ctx.fillStyle = st.fg;
    ctx.font = "bold 36px sans-serif";
    ctx.fillText(labelOverride ?? st.label, 20, height - 70, width - 40);
    ctx.font = "28px monospace";
    ctx.fillText(`t=${t.toFixed(1)}s`, 20, height - 30);

    raf = requestAnimationFrame(draw);
  };
  draw();

  // NOTE: requestAnimationFrame on the *window* is suspended on some browsers
  // while an immersive XR session is presenting. A setInterval fallback keeps
  // the mock canvas painting so a frozen mock in VR isn't misread as a
  // texture bug. (The live WebRTC track has no such dependency.)
  const interval = setInterval(() => {
    cancelAnimationFrame(raf);
    draw();
  }, 1000 / fps);

  let stream: MediaStream | null = null;
  let error: string | null = null;
  const cap = (canvas as HTMLCanvasElement & {
    captureStream?: (fps?: number) => MediaStream;
  }).captureStream;
  if (typeof cap === "function") {
    stream = cap.call(canvas, fps);
  } else {
    error = "canvas.captureStream() not supported in this browser";
  }

  return {
    stream,
    error,
    setScene: (s) => {
      scene = s;
    },
    setLabel: (text) => {
      labelOverride = text;
    },
    stop: () => {
      clearInterval(interval);
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((tr) => tr.stop());
    },
  };
}
