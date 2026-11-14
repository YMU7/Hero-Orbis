# TEST_REPORT: Orbis × WebXR MVP (target: Meta Quest 3 / Meta Quest Browser)

> This file holds **desktop and IWER-emulator** results. Physical Quest 3
> results go in [`PHYSICAL_DEVICE_TEST.md`](PHYSICAL_DEVICE_TEST.md), and
> emulator results never count as device results.

Every case is **PASS / FAIL / NOT TESTED**. "EMULATED" means Meta's IWER
`metaQuest3` runtime in desktop Chromium. It exercises the WebXR API path,
**not** Quest hardware, its browser, or its media pipeline. No device result
here is inferred.

## Environment

| Item | Value |
|---|---|
| Date | 2026-11-14 |
| Dev machine | Windows 11 Pro 10.0.26300, Node v26.13.1, pnpm 10.34.9 |
| Packages | next 15.5.24, react 19.2.8, three 0.187, @reactor-models/visko-orbis-stable 2.3.0, @reactor-team/js-sdk 3.0.0, iwer 2.8.0 |
| Desktop browser | Claude desktop in-app browser (Chromium 156) |
| `REACTOR_API_KEY` | none for the first runs; a borrowed test key (server-side `.env` only) from 12:00 on |
| Headset | **none used** (Quest 3 not tested) |

## Build / static

| Case | Result | Evidence |
|---|---|---|
| `pnpm build` (includes `tsc`) | PASS | All routes build. IWER is a lazy chunk (`/mvp` first load 267 kB) |
| `pnpm lint` | NOT TESTED | No lint script in the template |
| API key absent from client bundle and source | PASS | The key is read only in the token route. `.env` is git-ignored |

## Gate A: official live video outside VR

| Case | Result | Notes |
|---|---|---|
| `/` renders the setup page without a key (no 500) | PASS | |
| `/api/reactor/token` without a key returns a JSON error | PASS | `500 {"error":"REACTOR_API_KEY is not set on the server"}` |
| Token route mints a session JWT with a key | PASS | 200, `{jwt, expires_at}`, `Cache-Control: private, no-store` |
| Connect → `ready` | PASS | `connecting → waiting → ready` in ~2 s, `main_video` track received at `ready` |
| `set_prompt(initial)` → `start`, ongoing video on desktop (`/mvp` plane + thumbnail) | PASS | `generation_started 2560x1440 @ 18 fps (2k)`. Courtyard with a tree visible. Texture 17.9 uploads/s at first |
| Auto-start on `ready` | FAIL, then FIXED, then PASS | The model sends no `state` until the first command, so waiting for a snapshot deadlocked. Now it starts on `ready`, once per `sessionId` |
| Mid-run `set_prompt(rain)` → ack, no `start`/`reset` sent | PASS | `prompt_accepted` at chunk 11. Log shows only `set_prompt` |
| Picture visibly changes after steering | PASS (desktop) | Warm sunlit courtyard → dark, blue-toned wet scene within ~10 s. Framing drifted to close-up leaves (model drift) |
| `set_prompt(night)` on same session | PASS (ack) | Acked at chunk 24, same `sessionId`, chunk counter kept increasing |
| Disconnect → clean state | PASS | status, session, started, chunk, prompt all cleared, track released |
| Reconnect → new session, auto-start, video | PASS | New `sessionId`, started within 1 s of `ready` |
| `?res=1080p` → `set_resolution` before `start` | PASS | `available=[1080p, 2k, 4k]`, `generation_started 1920x1080 @ 18 fps (1080p)` |

## Gate B: mock video texture

| Case | Result | Evidence |
|---|---|---|
| Scene renders: room, 16:9 plane ~2.4 m, two buttons, HUD | PASS | Desktop screenshot |
| Mock visibly labelled MOCK | PASS | In-frame banner, 3D label, HUD, panel |
| Mock stream animates on plane (desktop) | PASS | `readyState=4`, 832×468, ~30 texture uploads/s |
| Mouse raycast selects 3D button; cooldown blocks repeat; no Reactor command in mock | PASS | Log: `select "rain" via desktop mouse` → `MOCK scene → rain (no Reactor command sent)` → `mock steer ignored (cooldown)` |
| Desktop without XR device: `immersive-vr` false, "VR NOT SUPPORTED" | PASS | Expected |
| **EMULATED** Quest 3: `isSessionSupported('immersive-vr')` true, ENTER VR shown | PASS | IWER `metaQuest3`, required `forceInstall` because desktop Chromium exposes a device-less native `navigator.xr` |
| **EMULATED** immersive session opens, stereo render, both controller rays | PASS | Screenshot. Input sources: `left/right tracked-pointer [meta-quest-touch-plus, oculus-touch-v3, oculus-touch, generic-trigger-squeeze-thumbstick]` |
| **EMULATED** video keeps playing on the plane during the immersive session | PASS | With the pane visible: `render ~295 fps, tex 29–31/s, media +1s/s, playing=true` (source is a 30 fps mock). Session summary: `39s in XR, 1009 texture uploads (avg 25.9/s), stalled 0s, fallback=false`. The average includes ~1 s of throttled session startup |
| **EMULATED** right-controller trigger selects 3D button | PASS | Log: `select "rain" via controller 1 (right, tracked-pointer)` → `MOCK scene → rain`. Second trigger on NIGHT within cooldown → `mock steer ignored (cooldown)` |
| rVFC-stall fallback keeps texture updating | PASS (simulated) | `requestVideoFrameCallback` patched to never fire → panel `FALLBACK`. Uploads then matched the render rate (0.5/s at 0.5 fps, since the window was backgrounded) instead of 0 |
| Hidden or backgrounded tab is reported as throttling, not a video stall | PASS | Log: `XR render loop throttled: 6.7 fps`, `stalled 0s` |
| Haptic tick on trigger | NOT TESTED | IWER doesn't surface haptics visibly |
| **Quest 3 hardware**: session, mock plane in VR, trigger select | NOT TESTED | No device |

## Gate C: live stream as VR texture

| Case | Result | Notes |
|---|---|---|
| `main_video` → app-owned `<video>` → same plane | NOT TESTED | Needs key |
| Live texture keeps updating inside immersive VR (watchdog `tex/s` ≈ 18) | NOT TESTED | Needs key + device (or key + emulator) |
| Autoplay / "Start media" on Quest Browser | NOT TESTED | |

## Gate D: in-VR steering

| Case | Result | Notes |
|---|---|---|
| Trigger → `set_prompt` on same session, no `start`/`reset` | NOT TESTED (live) | Code path shared with the emulated mock test up to `steer()` |
| Ack logged separately from visual change | NOT TESTED | |
| Visible change in live stream | NOT TESTED | |
| `command_error` / SDK refusal displayed | NOT TESTED | Both listeners wired |

## Gate E: Meta Quest 3 hardware

| Case | Result |
|---|---|
| Quest Browser loads `/mvp` (adb reverse localhost or HTTPS tunnel) | NOT TESTED |
| ENTER VR appears; immersive session starts | NOT TESTED |
| Mock plane animates in VR (watchdog: no STALLED, no FALLBACK) | NOT TESTED |
| Live `main_video` animates in VR | NOT TESTED |
| Touch Plus trigger and hand pinch select; record reported profiles | NOT TESTED |
| Disconnect/reconnect in headset | NOT TESTED |
| Headset screen recording | NOT TESTED |

On device, record: Quest OS version ______, Quest Browser version ______,
access method (adb reverse / tunnel) ______, reported input profiles ______,
session summary line from the log ______.

## Issues found

1. **three@0.187 `VideoTexture` relies only on `requestVideoFrameCallback`**
   when it's available. If a browser throttles rVFC during an immersive
   session, the plane freezes while the video keeps playing. **Mitigated**:
   the watchdog plus a ≤30 Hz forced-upload fallback, verified by simulation.
   Whether Quest Browser actually throttles rVFC in XR is unknown until
   tested on the device.
2. **IWER won't install over desktop Chromium's native `navigator.xr`.**
   Fixed with `forceInstall`, which is used only after confirming that native
   `immersive-vr` is unsupported.
3. **A hidden or backgrounded page throttles the XR loop to ~1 Hz** (seen in
   the emulator whenever the browser pane or window wasn't in view). This is a
   test artifact, now labelled separately so it isn't mistaken for a video stall.

## Acceptance checklist

- [ ] Official sample runs on desktop with real API: **NOT TESTED** (no key)
- [ ] Desktop can start and steer the same Orbis session: **NOT TESTED**
- [ ] WebXR immersive session on Quest 3 / Quest Browser: **NOT TESTED** (emulated: PASS)
- [ ] Mock video on a 3D plane in headset VR: **NOT TESTED** (emulated: PASS)
- [ ] Live `main_video` on the same plane: **NOT TESTED**
- [ ] Controller press triggers `set_prompt` without restart: **NOT TESTED live** (emulated trigger → mock: PASS)
- [ ] Visible change in live stream: **NOT TESTED**
- [x] Status/error diagnostics available (panel, HUD, console): **PASS**
- [x] Credentials stay server-side: **PASS**
- [ ] Full results recorded: **partial**

## Live stream delivery measurements (desktop, this PC's network, 2026-11-14)

| Run | Tier | WebRTC received | Bitrate | Loss / RTT / path | `<video>` decoded | Texture |
|---|---|---|---|---|---|---|
| Session 1 (first ~20 s) | 2K | ~18 fps | — | — | ~18 fps | 17.9/s |
| Session 1 (after ~40 s) | 2K | — | — | — | **0.5–4 fps** | (false FALLBACK, since fixed) |
| Session 2 | 2K | **1 fps** | 260–500 kbps | 0.4–0.6% / 23–69 ms / relay → prflx | 0–1 fps | (false FALLBACK, since fixed) |
| Session 3 | 1080p | **3–5 fps** | 460–630 kbps | 0.2–0.3% / 29–64 ms / prflx | 3–4 fps | 2–4/s (= decoded, no FALLBACK) |
| Session 4 (emulated XR) | 1080p | **18 fps** | 2.2–5.1 Mbps | 0% / ~30 ms / prflx | 18 fps | limited by hidden-window throttling (see below) |

**Reading:** the model kept generating (chunks advanced ~2 s each) in every
run. When the picture stuttered, the cause was **WebRTC delivery bandwidth**
(sometimes only ~0.5 Mbps), not rendering. 1080p roughly tripled the frame
rate at the same bandwidth. Delivery varied between runs, and in session 4
it ran at a full 18 fps.

## Gate C (EMULATED): live stream in IWER Quest 3 immersive session

| Case | Result | Evidence |
|---|---|---|
| Live `main_video` keeps decoding during emulated immersive session | PASS (emulated) | `decoded 18 fps` throughout 14 s in XR, `media +2 s/s` |
| Texture receives live frames in emulated XR | PASS (emulated, limited) | tex/s equalled render fps (every rendered frame showed a fresh frame), `stalled 0s`, `fallback=false`. The app window was hidden (`visibilityState: hidden`), so render ran at 0.5–1 fps and no full-rate XR figure exists |

## Watchdog corrections made during live testing

1. **False FALLBACK on a slow source:** it measured time since the last
   upload, so a 1 fps stream looked like a stalled `requestVideoFrameCallback`
   and forced redundant 2K uploads at 30 Hz. Now it measures how long a
   **new decoded frame** (`getVideoPlaybackQuality().totalVideoFrames`) waits
   without an upload. Verified: `tex ≈ decoded`, no false FALLBACK at 3–4 fps.
2. **"Source slow" reported separately:** `decoded < 5 fps` logs
   `SOURCE slow (stream/network, not rendering)` and isn't counted as a stall.
3. **WebRTC stats surfaced** from the SDK's `useStats()` (fps, kbps, loss, RTT, candidate type).
