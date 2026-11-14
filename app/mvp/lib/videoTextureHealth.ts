"use client";

import type * as THREE from "three";

// Watchdog for "does the video keep playing on the plane inside immersive XR?"
//
// three@0.187 VideoTexture: when the element supports
// requestVideoFrameCallback (rVFC), texture uploads happen ONLY from the rVFC
// callback (VideoTexture.update() is a no-op then). rVFC is tied to the
// window's rendering steps; if a browser stops servicing it while an
// immersive session owns the display, the plane would freeze even though the
// <video> keeps playing. This monitor detects that and falls back to manual
// uploads, and reports numbers so a stall is visible.
//
// It separates three cases using the element's own decoded-frame counter
// (getVideoPlaybackQuality().totalVideoFrames):
//   - source slow   : decodedFps low, texFps ≈ decodedFps  → network/stream, not rendering
//   - texture stall : decodedFps healthy, texFps ≈ 0        → rVFC stalled → fallback
//   - loop throttled: renderFps low                         → page hidden / device overloaded
// The fallback only uploads when a NEW decoded frame exists, so a slow source
// never causes redundant uploads of the same (possibly 2K) frame.

export type VideoHealth = {
  /** Texture uploads per second over the last window. */
  texFps: number;
  /** Frames the <video> element decoded per second (null if unsupported). */
  decodedFps: number | null;
  /** Seconds of media time that advanced during the last window. */
  mediaAdvance: number;
  playing: boolean;
  /** True once manual upload fallback engaged (rVFC stalled while frames arrived). */
  fallback: boolean;
  /** Frame-loop ticks per second (XR frames when presenting). */
  renderFps: number;
};

const STALL_MS = 600;
const FALLBACK_MIN_INTERVAL_MS = 33; // ≤30 Hz even in fallback
const REPORT_MS = 1000;

function decodedFrames(v: HTMLVideoElement): number | null {
  const q = (v as HTMLVideoElement & {
    getVideoPlaybackQuality?: () => VideoPlaybackQuality;
  }).getVideoPlaybackQuality?.();
  return q ? q.totalVideoFrames : null;
}

export class VideoTextureMonitor {
  private tex: THREE.VideoTexture | null = null;
  private video: HTMLVideoElement | null = null;
  private lastVersion = -1;
  private lastVersionAt = 0;
  /** Decoded-frame count at the moment of the last texture upload. */
  private decodedAtUpload: number | null = null;
  private lastManualAt = 0;
  /** When an un-uploaded decoded frame was first observed. */
  private newFrameSeenAt: number | null = null;
  private uploads = 0;
  private ticks = 0;
  private windowStart = 0;
  private windowMediaStart = 0;
  private windowDecodedStart: number | null = null;
  private fallback = false;

  constructor(private readonly onReport: (h: VideoHealth) => void) {}

  setSource(tex: THREE.VideoTexture | null, video: HTMLVideoElement | null) {
    this.tex = tex;
    this.video = video;
    const now = performance.now();
    this.lastVersion = tex ? tex.version : -1;
    this.lastVersionAt = now;
    this.decodedAtUpload = video ? decodedFrames(video) : null;
    this.uploads = 0;
    this.ticks = 0;
    this.windowStart = now;
    this.windowMediaStart = video?.currentTime ?? 0;
    this.windowDecodedStart = this.decodedAtUpload;
    this.newFrameSeenAt = null;
    this.fallback = false;
  }

  /** Call once per rendered frame (XR or not), before renderer.render(). */
  tick(now = performance.now()) {
    const { tex, video } = this;
    if (!tex || !video) return;
    this.ticks++;
    const playing = video.readyState >= 2 && !video.paused && !video.ended;
    const decoded = decodedFrames(video);
    // A new frame exists that the texture hasn't uploaded yet.
    const hasNewFrame =
      decoded === null ? playing : this.decodedAtUpload === null || decoded > this.decodedAtUpload;

    if (tex.version !== this.lastVersion) {
      this.uploads += tex.version - this.lastVersion;
      this.lastVersion = tex.version;
      this.lastVersionAt = now;
      this.decodedAtUpload = decoded;
      this.newFrameSeenAt = null;
    } else if (playing && hasNewFrame) {
      // Measure how long a NEW decoded frame has waited without an upload —
      // not time since the last upload (a 1 fps source would false-trigger).
      if (this.newFrameSeenAt === null) this.newFrameSeenAt = now;
      else if (now - this.newFrameSeenAt > STALL_MS) this.fallback = true; // rVFC stalled
    }

    if (
      this.fallback &&
      playing &&
      hasNewFrame &&
      now - this.lastManualAt >= FALLBACK_MIN_INTERVAL_MS
    ) {
      this.lastManualAt = now;
      tex.needsUpdate = true; // counted as an upload on the next tick
    }

    if (now - this.windowStart >= REPORT_MS) {
      const secs = (now - this.windowStart) / 1000;
      const r1 = (x: number) => Math.round(x * 10) / 10;
      this.onReport({
        texFps: r1(this.uploads / secs),
        decodedFps:
          decoded !== null && this.windowDecodedStart !== null
            ? r1((decoded - this.windowDecodedStart) / secs)
            : null,
        mediaAdvance: Math.round((video.currentTime - this.windowMediaStart) * 100) / 100,
        playing,
        fallback: this.fallback,
        renderFps: r1(this.ticks / secs),
      });
      this.ticks = 0;
      this.uploads = 0;
      this.windowStart = now;
      this.windowMediaStart = video.currentTime;
      this.windowDecodedStart = decoded;
    }
  }
}
