"use client";

// MediaStream → app-owned HTMLVideoElement (brief §3 Gate C).
//
// The element is created and owned by the app (never reached for inside the
// SDK's <ViskoOrbisStableMainVideoView>), kept in the DOM and *visible*
// (a small thumbnail), so browsers don't throttle or pause it. The XR scene
// builds exactly one THREE.VideoTexture per element and reuses it.

export type PlayResult = { ok: true } | { ok: false; error: string };

/** Attach `stream` (or detach with null) and try to play. Muted + inline so
 *  autoplay policies allow it; audio is out of scope for the MVP gate. */
export async function bindStream(
  video: HTMLVideoElement,
  stream: MediaStream | null,
): Promise<PlayResult> {
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  if (video.srcObject !== stream) video.srcObject = stream;
  if (!stream) return { ok: true };
  return playVideo(video);
}

/** Explicit play — also what the "Start media" button calls (a user gesture
 *  that satisfies the strictest autoplay policies). */
export async function playVideo(video: HTMLVideoElement): Promise<PlayResult> {
  try {
    await video.play();
    return { ok: true };
  } catch (err) {
    const e = err as Error;
    // AbortError is the benign "a new load interrupted play()" case the
    // reference app documents; the next bind/play recovers it.
    return { ok: false, error: `${e.name}: ${e.message}` };
  }
}

/** Wrap a single received track for a <video>. A fresh MediaStream per track
 *  so a reconnect (new track object) always re-binds. */
export function streamForTrack(track: MediaStreamTrack | undefined) {
  return track ? new MediaStream([track]) : null;
}

export type VideoStatsSnapshot = {
  readyState: number;
  width: number;
  height: number;
  paused: boolean;
  frameCount: number;
  hasStream: boolean;
};

/** Poll an element's playback state and count presented frames (via
 *  requestVideoFrameCallback when available). Returns a stop function. */
export function watchVideo(
  video: HTMLVideoElement,
  onStats: (s: VideoStatsSnapshot) => void,
  intervalMs = 500,
): () => void {
  let frames = 0;
  let stopped = false;
  type RVFC = (cb: () => void) => number;
  const rvfc = (video as unknown as { requestVideoFrameCallback?: RVFC })
    .requestVideoFrameCallback;
  const onFrame = () => {
    if (stopped) return;
    frames++;
    rvfc!.call(video, onFrame);
  };
  if (rvfc) rvfc.call(video, onFrame);

  // Without rVFC, approximate frame progress from currentTime changes.
  let lastTime = -1;
  const timer = setInterval(() => {
    if (!rvfc && video.currentTime !== lastTime) {
      lastTime = video.currentTime;
      frames++;
    }
    onStats({
      readyState: video.readyState,
      width: video.videoWidth,
      height: video.videoHeight,
      paused: video.paused,
      frameCount: frames,
      hasStream: video.srcObject instanceof MediaStream,
    });
  }, intervalMs);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
