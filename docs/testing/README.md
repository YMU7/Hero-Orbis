# Test reports

| Report | Scope | Counts as device evidence |
|---|---|---|
| [quest3-device.md](quest3-device.md) | Physical Meta Quest 3, Meta Quest Browser | Yes |
| [desktop-and-emulator.md](desktop-and-emulator.md) | Desktop Chromium; Meta IWER Quest 3 emulation | No |

## Conventions

- Each case is **PASS**, **FAIL**, **PARTIAL**, or **NOT TESTED**.
- A case is marked PASS only when it was observed or logged on the stated platform. Emulator results never substitute for device results.
- Evidence cites the event-log line or measurement it rests on. Times are Pacific (UTC−8) on 2026-11-14.

## Summary (2026-11-14)

| Capability | Desktop | Emulated Quest 3 | Physical Quest 3 |
|---|---|---|---|
| WebXR `immersive-vr` session | n/a | PASS | PASS |
| Mock stream on the VR plane | PASS | PASS | NOT TESTED (in VR) |
| Live Orbis stream on the plane | PASS | PASS (throttled window) | PASS |
| Controller trigger → `set_prompt` on one session | PASS (mouse/panel) | PASS (mock) | PASS (live) |
| Visible change after steering | PASS | n/a | NOT TESTED |
| Texture keeps up with decoded frames | PASS | PASS | PASS |
| Sustained 18 fps stream delivery | FAIL (varies by run) | Not established (14 s sample at 18 fps) | FAIL |
