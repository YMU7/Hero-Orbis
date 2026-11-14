# Device test report: Meta Quest 3

## Scope

A physical Meta Quest 3 running Meta Quest Browser loads `/mvp` from the development PC. Two runs were made:

| Run | Source | Reactor key | Time (PT, 2026-11-14) |
|---|---|---|---|
| 1 | Mock canvas stream | None | 13:31 |
| 2 | Live Visko Orbis | Team key | 13:46–13:48 |

Results come only from logs and observations on the headset. Emulator results are in [desktop-and-emulator.md](desktop-and-emulator.md).

## Environment

| Item | Value |
|---|---|
| Headset | Meta Quest 3 |
| Browser | Meta Quest Browser (version not recorded) |
| OS build | Not recorded |
| Display rate | ~90 Hz (inferred from measured XR frame rate) |
| Network path | Wi-Fi → Cloudflare quick tunnel (HTTPS) → `next start` on the PC |
| Server | Next.js 15.5 production build, Windows 11 |
| Basic Auth | Off (team decision for the event) |

### Why a tunnel instead of USB

USB debugging was not available. The headset enumerated only Quest Link interfaces (USB PID `5010`, no ADB interface), including after a PC restart with the Link service stopped. ADB is not required for WebXR, so the test used HTTPS over Wi-Fi.

## Results: run 1 (mock, no key)

| ID | Case | Result | Evidence |
|---|---|---|---|
| P0.1 | `adb devices` lists the headset | FAIL (not required) | No ADB interface (Link-only USB mode) |
| P0.2 | `/mvp` loads over the HTTPS tunnel | PASS | Observed by tester |
| P0.3 | Mock mode without a key | PASS | `source mode → MOCK`, `reactor status → disconnected` |
| P0.4 | WebXR available in a secure context | PASS | `isSessionSupported('immersive-vr') = true` |
| P0.5 | Mock stream plays in the 2D page | PASS | `media mock stream playing` |
| P0.6 | 2D pointer selection and cooldown | PASS | `select "rain" via desktop mouse` → `MOCK scene → rain`; `night` at +4 s → `mock steer ignored (cooldown)`; `night` at +6 s → `MOCK scene → night` |
| P1.1 | ENTER VR starts an immersive session | PASS | Observed by tester |
| P1.2 | Plane, MOCK label, and HUD visible in VR | NOT TESTED | Tester reported no issues; no specific observation recorded |
| P2–P6 | Tracking, in-VR selection, playback, frame rate (mock) | NOT TESTED | Covered by run 2 with the live source |
| P7.1 | Exit VR with the Meta button | PASS | Finding: no in-VR exit control is shown |

## Results: run 2 (live Orbis)

| ID | Case | Result | Evidence |
|---|---|---|---|
| L0.1 | Page loads with the live key | PASS | `source mode → LIVE`; `immersive-vr = true` |
| L0.2 | Connect and auto-start | PASS | `connecting → ready` in 2 s; `set_prompt(initial)` → `start ok` |
| L0.2a | 1080p delivery requested | FAIL | No `set_resolution` was sent; the run used 2560×1440 (`?res=1080p` was likely absent from the URL) |
| L0.3 | Live picture plays in the 2D page | PASS | `live <video> playing main_video` |
| L1.1 | Immersive session with the live source | PASS | `immersive session started (source: LIVE)` |
| L2.1 | Head tracking world-locked | NOT TESTED | No observation recorded |
| L3.1 | Both controllers tracked | PASS | Two `tracked-pointer` sources: `meta-quest-touch-plus, oculus-touch-v3, oculus-touch-v2, oculus-touch, generic-trigger-squeeze-thumbstick` |
| L3.2 | Automatic hand-tracking switch | PASS (observed) | `meta-fixed-hand, generic-fixed-hand, generic-hand-select, generic-trigger` |
| L4.1 | Trigger sends `set_prompt` on the same session | PASS | `night` 13:47:18, `rain` 13:47:31, `night` 13:47:49 via `controller 1 (right, tracked-pointer)`, each `← set_prompt(...) ok`; no further `start` or `reset` |
| L4.1b | Current prompt is not re-sent | PASS | `steer "night" not sent — already on "night"` |
| L4.2 | Picture visibly changes after steering | NOT TESTED | Visual report pending |
| L4.3 | Cooldown blocks a second press in VR | NOT TESTED | No press within 4 s occurred in VR |
| L5.1a | Texture keeps up with decoded frames | PASS | `tex` equalled `dec` in every 5 s window (e.g. 17.9/17.9, 4/4, 2/2); `fallback=false` |
| L5.1b | 18 fps delivery sustained for ≥1 min | FAIL | 18 fps from 13:47:09 to 13:47:29; 0–7 fps from 13:47:34 until exit (`SOURCE slow`) |
| L5.2 | Session summary | PASS | `94s in XR, 643 texture uploads (avg 6.8/s), stalled 0s, min render 69.7 fps, fallback=false` |
| L6.1 | XR render rate | PASS | 78.5–89.7 fps per 5 s window; minimum 69.7 fps |
| L6.2 | WebRTC statistics on Quest Wi-Fi | NOT TESTED | `webrtc in` values not captured |
| L7.1 | Exit VR, then disconnect | PASS | Session ended 13:48:40; `disconnected` 13:48:51 |

## Findings

1. **Rendering on Quest Browser is not the bottleneck.** `requestVideoFrameCallback` continued to fire inside the immersive session, and every decoded frame reached the texture. The upload fallback never engaged.
2. **Stream delivery degraded after ~30 s**, matching the pattern seen on desktop. Rendering stayed at ~86 fps while decoded frames dropped, which points upstream of the decoder. The run used 2K delivery. A repeat at 1080p with WebRTC statistics captured is pending.
3. **No in-VR exit affordance.** A first-time user needed instructions to leave VR (Meta button).

## Raw log (run 2, excerpt)

```text
13:46:31 info reactor status → ready
13:46:31 cmd ← set_prompt(initial) ok
13:46:31 cmd ← start ok
13:46:31 info generation_started 2560x1440 @ 18 fps (2k)
13:47:04 xr immersive session started (source: LIVE)
13:47:09 xr XR video: render 89.7 fps, decoded 17.9 fps, tex 17.9/s, media +1s/s, playing=true
13:47:18 xr select "night" via controller 1 (right, tracked-pointer)
13:47:19 cmd ← set_prompt(night) ok
13:47:31 xr select "rain" via controller 1 (right, tracked-pointer)
13:47:32 cmd ← set_prompt(rain) ok
13:47:34 error XR video SOURCE slow: decoded 4 fps (stream/network, not rendering)
13:47:49 xr select "night" via controller 1 (right, tracked-pointer)
13:47:50 cmd ← set_prompt(night) ok
13:48:35 xr XR video: render 78.5 fps, decoded 1 fps, tex 1/s, media +1.01s/s, playing=true
13:48:40 xr immersive session ended — 94s in XR, 643 texture uploads (avg 6.8/s), stalled 0s, min render 69.7 fps, fallback=false
13:48:51 info reactor status → disconnected
```
