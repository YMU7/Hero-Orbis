# Physical device test: Meta Quest 3, MOCK video only

**Scope:** a real Quest 3 running Meta Quest Browser, loading `/mvp` from
the dev PC over USB (`adb reverse`), with **no** `REACTOR_API_KEY` and **no**
Orbis connection. The source is the labelled MOCK canvas stream.

**Rules:**
- Results come only from what was observed on the Quest 3.
- IWER emulator results live in `TEST_REPORT.md` and do **not** count here.
- Status is **PASS / FAIL / NOT TESTED**. A row stays NOT TESTED until
  someone has seen it on the device.

## Device info

| Item | Value |
|---|---|
| Test date | |
| Quest 3 OS / build version | |
| Meta Quest Browser version | |
| Connection | **Wi-Fi + Cloudflare quick tunnel (HTTPS)** → `https://<random>.trycloudflare.com/mvp`. USB/ADB was unavailable: the headset stayed in Link USB mode (PID 5010, no ADB interface), even after a PC reboot. Server ran with NO key (`.env.disabled`), so the token route returns 500 |
| PC | Windows 11, server `next start` on port 3000 |
| Controller profiles reported (panel "input sources") | |
| Refresh rate set on headset (72 / 90 / 120 Hz) | |

## How to read the metrics

- **Headset HUD** (under the video plane, line 3):
  `fps N  tex N/s  media +Ns  ctrl N  WxH [FALLBACK]`
  - `fps`: XR frames per second (should sit near the headset refresh rate).
  - `tex`: texture uploads per second (should be about 30 for the mock).
  - `media`: seconds of video time per second (should be about 1 while playing).
  - `ctrl`: tracked input sources (2 = both controllers).
  - `FALLBACK`: the frame-callback fallback engaged. Note it if it appears.
- **Event log** (desktop panel in the 2D page, or `chrome://inspect` console,
  prefix `[mvp:…]`): `XR video: …` every 5 s, `VIDEO STALLED in XR`,
  `XR render loop throttled`, and on exit:
  `immersive session ended — Ns in XR, N texture uploads (avg N/s), stalled Ns, min render N fps, fallback=…`.
- **On-plane `t=` counter:** the mock's own clock. If it advances, the plane
  is showing fresh frames.

## Checklist

| ID | Test | How to verify | Result | Notes / numbers |
|---|---|---|---|---|
| P0.1 | `adb devices` shows the Quest as `device` | PC terminal | FAIL (not needed) | No ADB interface on USB (Link mode, PID 5010). Testing continues over Wi-Fi + HTTPS, so ADB is not required for WebXR |
| P0.2 | `/mvp` loads in Quest Browser via the HTTPS tunnel URL | Page shows scene + panel | PASS | User report 2026-11-14: page opened in Quest Browser over the tunnel |
| P0.3 | No-key mock mode: panel shows `MOCK` selected, LIVE disabled, status `disconnected` | Panel | PASS | Quest log 13:31:42: `source mode → MOCK`, `reactor status → disconnected`; user saw "MOCK — NOT LIVE ORBIS" |
| P0.4 | `secure context` = true, `navigator.xr` = yes, `immersive-vr supported` = yes | Panel, WebXR section | PASS | Quest log 13:31:42: `isSessionSupported('immersive-vr') = true`. That call needs `navigator.xr`, which browsers only expose in a secure context |
| P0.5 | Mock video plays in 2D (thumbnail + plane animate) | Visual | PASS | Quest log 13:31:42: `media mock stream playing` |
| P0.6 | 2D-page pointer selection (Quest Browser laser as mouse, NOT WebXR) | Click 3D buttons in the 2D page | PASS | Quest log 13:31:51–57: `select "rain" via desktop mouse` → `MOCK scene → rain`; `select "night"` at +4 s → `mock steer ignored (cooldown)`; `night` at +6 s → `MOCK scene → night` |
| P1.1 | **ENTER VR** starts the immersive session | Tap button | PASS | User report: entered immersive VR in Quest Browser; scene matched the 2D page |
| P1.2 | In VR: plane visible ~2.4 m ahead, "MOCK — NOT LIVE" label, HUD readable | Visual | NOT TESTED | User entered VR once and "felt it was fine"; no measurement or specific observation recorded. In-VR checks moved to the live run (L-rows) |
| P2.1 | Head tracking: rotate and lean; scene stays world-locked, no swimming or lag | Visual | NOT TESTED | |
| P3.1 | Controller tracking: both rays follow the controllers; HUD `ctrl 2` | Visual + HUD | NOT TESTED | |
| P4.1 | Hover: pointing at RAIN highlights it | Visual | NOT TESTED | |
| P4.2 | Trigger on **RAIN** → plane switches to blue "RAIN (mock)", haptic tick, buttons dim | Visual / feel | NOT TESTED | |
| P4.3 | Second trigger within 4 s is ignored (cooldown) | Visual; log `mock steer ignored (cooldown)` | NOT TESTED | |
| P4.4 | After cooldown, trigger on **NIGHT** → plane switches to dark "NIGHT (mock)" | Visual | NOT TESTED | |
| P5.1 | Continuous playback: `t=` counter and moving dots keep advancing for ≥60 s in VR | Visual | NOT TESTED | |
| P5.2 | Texture rate: HUD `tex` ≈ 30/s, `media +1s`, no `FALLBACK` | HUD | NOT TESTED | |
| P5.3 | Stability: ≥3 min in VR, no freeze; exit summary `stalled 0s` | Log summary | NOT TESTED | |
| P6.1 | Frame rate: HUD `fps` steady near the refresh rate; record min from exit summary | HUD + summary | NOT TESTED | |
| P6.2 | No visible judder or stutter while turning the head | Visual | NOT TESTED | |
| P7.1 | Exit VR (Meta/Oculus button → resume to browser, or EXIT VR) returns to the 2D page | Visual | PASS (with finding) | Meta button exit worked. Finding: there is no in-VR exit control (EXIT VR is a DOM button, invisible in VR); a first-time user didn't know how to leave |
| P7.2 | Re-enter VR: second session works, video still playing | Visual + HUD | NOT TESTED | |
| P8.1 | (Optional) Hand tracking: put controllers down, pinch on RAIN/NIGHT selects | Visual | NOT TESTED | |

## Raw evidence

Paste the exit-summary lines and any `error` log lines here.

```
(none yet)
```

## Issues found on device

(none recorded yet)

## Live Orbis on Quest 3 (team key, consumes credits)

Setup: team key active (`.env`), **no Basic Auth (user decision: one-day event)**, same HTTPS tunnel,
URL `…/mvp?res=1080p` (1080p delivery: on the desktop it gave ~3× the frame rate of 2K at the same bandwidth).
Disconnect right after each run (no idle generation).

| ID | Test | How to verify | Result | Notes / numbers |
|---|---|---|---|---|
Run 1: 2026-11-14 13:46:05–13:48:51, Quest 3, Meta Quest Browser, live, team key. Evidence: the full event log the user pasted (below).

| ID | Test | How to verify | Result | Notes / numbers |
|---|---|---|---|---|
| L0.1 | Page loads in Quest Browser with the live key active | Visual | PASS | Log 13:46:05 `source mode → LIVE`, `isSessionSupported('immersive-vr') = true` |
| L0.2 | Connect → `ready`, auto-start | Panel log | PASS (with deviation) | `connecting → ready` in 2 s; auto `set_prompt(initial)` → `start ok`. **Ran at 2K (2560×1440), not 1080p**: no `set_resolution` was sent, so the `?res=1080p` param wasn't applied (likely missing from the URL; to confirm) |
| L0.3 | Live picture plays in 2D | Log | PASS | `live <video> playing main_video` 13:46:35 |
| L1.1 | ENTER VR with live source | Log | PASS | `immersive session started (source: LIVE)` 13:47:04 |
| L2.1 | Head tracking: world-locked, no swimming | Visual | NOT TESTED | No observation reported |
| L3.1 | Both controllers tracked | Log | PASS | Both `tracked-pointer [meta-quest-touch-plus, oculus-touch-v3, oculus-touch-v2, oculus-touch, generic-trigger-squeeze-thumbstick]`. Auto switch to hands seen: `[meta-fixed-hand, generic-fixed-hand, generic-hand-select, generic-trigger]` |
| L4.1 | Trigger → `set_prompt` acked on same session, no `start`/`reset` | Log | PASS | 3× via `controller 1 (right, tracked-pointer)`: night 13:47:18, rain 13:47:31, night 13:47:49, all `← set_prompt(...) ok`. No `start`/`reset` after the initial one |
| L4.1b | Duplicate press of current prompt is not re-sent | Log | PASS | 13:47:26 `steer "night" not sent — already on "night"` |
| L4.2 | Picture visibly changes after steering | Visual | NOT TESTED | User's visual observation pending |
| L4.3 | Cooldown blocks an immediate second press (in VR) | Log | NOT TESTED | No press inside a 4 s window in VR (tested in 2D mock: P0.6) |
| L4.4 | NIGHT acked + visible change | Visual + log | PARTIAL | Ack PASS (13:47:18, 13:47:49); visual change pending user report |
| L5.1a | Render/texture path keeps up in VR | Log | **PASS** | Texture = decoded every window (e.g. 17.9/17.9, 18/18, 4/4, 2/2); `stalled 0s`; `fallback=false`. **requestVideoFrameCallback works in Quest Browser XR** (open risk closed) |
| L5.1b | Live stream frame rate sustained in VR ≥ 1 min | Log | **FAIL** | 13:47:09–13:47:29: decoded **~18 fps** (full rate). From 13:47:34 on: **0–7 fps** for ~75 s (`SOURCE slow`). The picture visibly stuttered or near-froze. Cause is upstream of the decoder (stream/network), not rendering. Same pattern as desktop session 1 |
| L5.2 | Exit summary | Log | PASS | `94s in XR, 643 texture uploads (avg 6.8/s), stalled 0s, min render 69.7 fps, fallback=false` |
| L6.1 | XR render rate | Log | PASS | 78.5–89.7 fps per 5 s window (≈90 Hz display), min 69.7 fps |
| L6.2 | WebRTC on Quest Wi-Fi: fps / kbps / loss | Panel | NOT TESTED | `webrtc in` row not captured yet |
| L7.1 | Exit VR, then Disconnect | Log | PASS | Session ended 13:48:40 → `reactor status → disconnected` 13:48:51 (11 s after exit) |
