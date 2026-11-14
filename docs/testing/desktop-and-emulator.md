# Test report: desktop and emulated Quest 3

## Scope

Desktop Chromium, with and without Meta's Immersive Web Emulation Runtime (IWER) `metaQuest3` profile. IWER exercises the WebXR API path in a desktop browser. It does not reproduce Quest hardware, Meta Quest Browser, or its media pipeline. Device results are in [quest3-device.md](quest3-device.md).

## Environment

| Item | Value |
|---|---|
| Date | 2026-11-14 |
| OS | Windows 11 Pro 10.0.26300 |
| Runtime | Node.js 26.13.1, pnpm 10.34.9 |
| Browser | Chromium 156 (embedded) |
| Packages | next 15.5.24, react 19.2.8, three 0.187, @reactor-models/visko-orbis-stable 2.3.0, @reactor-team/js-sdk 3.0.0, iwer 2.8.0 |
| Reactor key | None for early runs; a test key (server-side only) for live runs |

## Build and security

| Case | Result | Evidence |
|---|---|---|
| `pnpm build` (includes type checking) | PASS | All routes build; IWER is loaded as a lazy chunk |
| Lint | NOT TESTED | The upstream template defines no lint script |
| API key absent from client code | PASS | The key is read only in `app/api/reactor/token/route.ts`; `.env*` is git-ignored |
| Token route without a key | PASS | `500 {"error":"REACTOR_API_KEY is not set on the server"}`; the setup page renders at `/` |
| Token route with a key | PASS | `200 {jwt, expires_at}`, `Cache-Control: private, no-store` |

## Live Orbis on desktop

| Case | Result | Evidence |
|---|---|---|
| Connect → `ready` | PASS | `connecting → waiting → ready` in ~2 s; `main_video` track received |
| `set_prompt(initial)` → `start` | PASS | `generation_started 2560x1440 @ 18 fps (2k)` |
| Auto-start on `ready` | PASS | Initially failed: the model sends no `state` until the first command. Fixed to start on `ready`, once per session |
| Live video on the plane | PASS | Texture 17.9 uploads/s at stream start |
| Steering without restart | PASS | `prompt_accepted` for `rain` (chunk 11) and `night` (chunk 24) on the same session |
| Visible change after steering | PASS | Warm sunlit courtyard → darker, blue-toned wet scene within ~10 s (framing drifted closer to the foliage) |
| Disconnect clears state | PASS | Status, session, chunk, and prompt cleared; track released |
| Reconnect | PASS | New session; generation started within 1 s of `ready` |
| `?res=1080p` | PASS | `available=[1080p, 2k, 4k]`; `generation_started 1920x1080 @ 18 fps (1080p)` |

### Stream delivery measurements

| Session | Tier | Received | Bitrate | Loss / RTT / path | Decoded | Texture |
|---|---|---|---|---|---|---|
| 1, first ~20 s | 2K | ~18 fps | — | — | ~18 fps | 17.9/s |
| 1, after ~40 s | 2K | — | — | — | 0.5–4 fps | n/a* |
| 2 | 2K | 1 fps | 260–500 kbps | 0.4–0.6% / 23–69 ms / relay → prflx | 0–1 fps | n/a* |
| 3 | 1080p | 3–5 fps | 460–630 kbps | 0.2–0.3% / 29–64 ms / prflx | 3–4 fps | 2–4/s |
| 4 (emulated XR) | 1080p | 18 fps | 2.2–5.1 Mbps | 0% / ~30 ms / prflx | 18 fps | see below |

\* Measured before the watchdog correction described below.

The model continued generating throughout (chunks advanced every ~2 s). Low frame rates matched low delivered bitrate, not rendering. At similar bandwidth, 1080p delivered roughly three times the frame rate of 2K.

## Mock source and WebXR (emulated)

| Case | Result | Evidence |
|---|---|---|
| Scene: floor, 16:9 plane at ~2.4 m, two controls, HUD | PASS | Screenshot |
| Mock labelled in frame, on a 3D label, and in the HUD | PASS | Screenshot |
| Mock stream on the plane | PASS | 832×468, ~30 uploads/s |
| Mouse selection and cooldown; no Reactor command in mock | PASS | `select "rain" via desktop mouse` → `MOCK scene → rain` → `mock steer ignored (cooldown)` |
| No XR device: `immersive-vr` unsupported | PASS | VRButton shows "VR NOT SUPPORTED" |
| Emulated `immersive-vr` supported | PASS | Requires `forceInstall`, because desktop Chromium exposes a device-less native `navigator.xr` |
| Emulated session: stereo render, two controller rays | PASS | Profiles `meta-quest-touch-plus, oculus-touch-v3, oculus-touch, generic-trigger-squeeze-thumbstick` |
| Mock video during the emulated session | PASS | `tex 29–31/s`; `39s in XR, 1009 texture uploads, stalled 0s, fallback=false` |
| Emulated trigger selection and cooldown | PASS | `select "rain" via controller 1 (right, tracked-pointer)`; a second press within the cooldown is ignored |
| Live video during the emulated session | PASS (limited) | `decoded 18 fps` for 14 s in XR; texture uploads equalled the render rate. The page was hidden, so rendering ran at 0.5–1 fps |
| Upload fallback when `requestVideoFrameCallback` stops | PASS (simulated) | Callback disabled → `FALLBACK`; uploads matched the render rate instead of 0 |
| Hidden page reported as throttling, not a stall | PASS | `XR render loop throttled`, `stalled 0s` |
| Haptic pulse | NOT TESTED | Not observable in IWER |

## Issues found and resolved

| Issue | Resolution |
|---|---|
| Auto-start waited for a `state` message that the model only sends after a command | Start on `ready`, guarded per session ID |
| IWER does not install over a native `navigator.xr` | `forceInstall`, only after native `immersive-vr` is confirmed unsupported |
| Watchdog flagged a slow source as a texture stall and re-uploaded identical 2K frames at 30 Hz | Stall now measured from the arrival of a new decoded frame (`getVideoPlaybackQuality().totalVideoFrames`); fallback uploads only new frames |
| Slow delivery indistinguishable from rendering faults | `SOURCE slow` reported separately; SDK `useStats()` WebRTC metrics added to the panel |
| React hydration mismatch in the diagnostics panel | Browser-only values read after mount |
| `three@0.187` `VideoTexture` depends entirely on `requestVideoFrameCallback` | Watchdog with a ≤30 Hz upload fallback. On Quest Browser the fallback was not needed (see device report) |
