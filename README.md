# Hero-Orbis

## Current project: princess room + Unity gameplay port

Run this application from the workspace root (not the nested backup clone):

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Open [the game](http://localhost:3000/puzzle?mode=mock). The home page opens the
puzzle. The original Reactor studio is at `/studio`; `/mvp`, `/rooms`, and the
scene editor remain available. Mock mode needs no API key.

**Quest headset:** run `pnpm dev:https`, then open
`https://<your-PC-Wi-Fi-IP>:3000/puzzle?mode=mock` in Meta Quest Browser on the
same network. Approve the development certificate on your own device and press
**ENTER VR**. For a trusted HTTPS URL, run `cloudflared tunnel --url http://localhost:3000`
against `pnpm dev` or `pnpm start`, then open its URL with `/puzzle?mode=mock`.
On campus Wi-Fi, device isolation can block direct PC-to-headset access; a tunnel
avoids that network limitation. Live mode uses the existing server-side
`REACTOR_API_KEY` configuration. Keep public tunnel access protected when using a key.

Left stick moves, right stick turns **smoothly** at up to 90°/s. Pinch near a tool,
or point a controller and hold grip/trigger to grab. Release to throw. Break the
red mute seal with the hammer. Follow the princess rescue sequence: try the rack sword, draw a sword on the
easel, burn the rope, and photograph the key to get it into the painting. Desktop uses
WASD, arrow keys, mouse drawing, and clicking the mute seal to perform a hammer strike.

Orbis audio generation is disabled for puzzle runs and its mixer channel defaults
to zero. Recorded princess dialogue and local room sounds remain enabled.

Unity source is archived at `archive/2026-11-14-unity-webxr-port/`.
See [migration details and verification limits](docs/unity/PORT.md).


**Step inside a world that Visko Orbis generates live, and steer it from VR.**

Hero streams a continuously generated video world from **Visko Orbis** into a WebXR scene on Meta Quest 3. The viewer aims a controller at an in-world control and pulls the trigger. The prompt changes on the same live generation session, and the world morphs at the next chunk boundary, with no restart.

Built at **Immerse the Bay 2026** (Stanford, November 13–15, 2026).

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
![Platform: Meta Quest 3](https://img.shields.io/badge/platform-Meta%20Quest%203-1c1e21)
![WebXR](https://img.shields.io/badge/WebXR-immersive--vr-6e40c9)
![Built at Immerse the Bay 2026](https://img.shields.io/badge/built%20at-Immerse%20the%20Bay%202026-0a7ea4)

**Links:** [Devpost project](https://devpost.com/software/hero-ktaups) · [Test reports](docs/testing/)

<!-- Demo video: add the YouTube link here once recorded. -->

---

## Contents

- [Overview](#overview)
- [Verified results](#verified-results)
- [How it works](#how-it-works)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Running on Meta Quest 3](#running-on-meta-quest-3)
- [Usage](#usage)
- [Diagnostics](#diagnostics)
- [Project structure](#project-structure)
- [Known limitations](#known-limitations)
- [Acknowledgements](#acknowledgements)
- [License](#license)

## Overview

Orbis is a live video model. It generates an unbroken stream in ~1.8 s chunks and accepts a new prompt at any time. Hero puts that stream inside VR and makes the prompt part of the room:

| | |
|---|---|
| **Live world** | The Orbis `main_video` WebRTC track is rendered as a texture on a 16:9 plane about 2.4 m in front of the viewer. |
| **In-VR steering** | Two ray-selectable 3D controls (`A · RAIN`, `B · NIGHT`) send `set_prompt` to the active session. |
| **One session** | The session is started once (`set_prompt` → `start`). Every later change is a `set_prompt` on that same session. |
| **Mock mode** | A clearly labelled canvas stream drives the same rendering path without an API key or network. |
| **Observability** | Render rate, decoded frame rate, texture uploads, and WebRTC statistics are shown on a desktop panel and an in-headset HUD. |

## Verified results

Measured on a physical **Meta Quest 3** in **Meta Quest Browser** on 2026-11-14. Full logs and per-test status are in [`docs/testing/quest3-device.md`](docs/testing/quest3-device.md).

| Check | Result |
|---|---|
| Live Orbis video on the VR plane | 18 fps stream rendered at the full stream rate (texture uploads = decoded frames) |
| XR render rate | 79–90 fps per 5 s window on the 90 Hz display (minimum 69.7 fps) |
| Controller steering on one session | 3 trigger presses → 3 `set_prompt` acknowledgements, no restart |
| Texture stalls during 94 s in XR | 0 s |
| Input sources reported | `meta-quest-touch-plus` controllers; automatic switch to hand tracking |

Not yet sustained: stream delivery fell from 18 fps to 0–7 fps after ~30 s in the same run. The diagnostics place the drop upstream of the decoder (stream or network), not in rendering. See [Known limitations](#known-limitations).

## How it works

```text
 Meta Quest 3 · Meta Quest Browser (HTTPS)                       Next.js server
┌──────────────────────────────────────────────────────┐    ┌─────────────────────────┐
│ ViskoOrbisStableProvider  (single connection owner)   │◄───│ GET /api/reactor/token  │
│   │  session-scoped JWT (memoized per session)        │    │  REACTOR_API_KEY → JWT  │
│   ▼                                                   │    └─────────────────────────┘
│ main_video MediaStreamTrack ──WebRTC── Visko Orbis    │
│   │                                                   │
│   ▼                                                   │
│ app-owned <video> ─► THREE.VideoTexture ─► 16:9 plane │
│                                                       │
│ XR controller ray ─► select (trigger) ─► set_prompt   │
└──────────────────────────────────────────────────────┘
```

1. **Authentication.** The server exchanges `REACTOR_API_KEY` for a session-scoped JWT (`/api/reactor/token`, `Cache-Control: private, no-store`). The browser memoizes that token for the session's lifetime and never sees the key.
2. **Connection.** The typed `ViskoOrbisStableProvider` from Reactor's reference app owns the only WebRTC session. `useViskoOrbisStableTrack("main_video")` exposes the raw track.
3. **Video bridge.** The track is bound to an app-owned `<video>` element. One `THREE.VideoTexture` is created per element and reused.
4. **Rendering.** Three.js renders the scene through `renderer.setAnimationLoop` in an `immersive-vr` session (`local-floor`).
5. **Steering.** A controller `select` event is raycast against the registered controls only. A hit sends `set_prompt` with a configurable cooldown (default 4 s) and a duplicate guard. `start` is never re-sent.
6. **Errors.** A refused command is captured both from the model's `command_error` broadcast and from the SDK `error` event (`operation: "sendCommand"`).

## Tech stack

| Layer | Technology |
|---|---|
| Live world model | Visko Orbis Stable (`reactor/visko-orbis-stable`) via `@reactor-models/visko-orbis-stable` 2.3 and `@reactor-team/js-sdk` 3.0 |
| XR / rendering | WebXR Device API, Three.js 0.187 (`VideoTexture`, `VRButton`) |
| Application | Next.js 15, React 19, TypeScript 5.9, Tailwind CSS 4, Zustand |
| Media transport | WebRTC (Orbis `main_video`) |
| Device | Meta Quest 3, Meta Quest Browser |
| Testing | Meta Immersive Web Emulation Runtime (IWER) for desktop emulation |
| Delivery | Cloudflare quick tunnel (HTTPS to headset) |

## Getting started

### Prerequisites

- Node.js 20 or later
- pnpm 10
- A Reactor API key for live mode (optional; mock mode works without one)

### Install and run

```bash
git clone https://github.com/YMU7/Hero-Orbis.git
cd Hero-Orbis
pnpm install
cp .env.example .env
pnpm build
pnpm start
```

Open `http://localhost:3000/mvp`. The Reactor reference app remains available at `/studio`.

### Configuration

| Variable | Required | Description |
|---|---|---|
| `REACTOR_API_KEY` | Live mode only | Server-side Reactor key. Read only by `app/api/reactor/token/route.ts`. Without it, `/mvp` runs in mock mode. |
| `BASIC_AUTH_USER`, `BASIC_AUTH_PASS` | Recommended for public URLs | Enables HTTP Basic Auth on every route, including the token endpoint (`middleware.ts`). |
| `ALLOWED_DEV_ORIGINS` | `pnpm dev` over LAN/tunnel only | Comma-separated hosts the Next.js dev server accepts. |

> **Windows:** if `next build` fails with `EXDEV … nextjs-nodejs\Config\config.json`, set `NEXT_TELEMETRY_DISABLED=1`.

## Running on Meta Quest 3

WebXR requires a secure context (HTTPS or `localhost`). The device tests served the app over an HTTPS tunnel on Wi-Fi; no USB or ADB connection was used.

```bash
pnpm start
```

```bash
cloudflared tunnel --url http://localhost:3000
```

Open `https://<random>.trycloudflare.com/mvp` in Meta Quest Browser. A tunnel URL is public: with `REACTOR_API_KEY` set, anyone who opens it can start sessions billed to your key. Set `BASIC_AUTH_USER`/`BASIC_AUTH_PASS`, or stop the tunnel when not in use.

## Usage

1. Open `/mvp`. With a key configured, the source defaults to **LIVE ORBIS**. Otherwise it defaults to **MOCK**.
2. Press **Connect**. Generation starts automatically when the session reaches `ready`.
3. Press **ENTER VR**.
4. Aim a controller at **A · RAIN** or **B · NIGHT** and pull the trigger. A hand-tracking pinch also works.
5. Exit with the Meta button, then press **Disconnect** to end generation.

| Query parameter | Effect |
|---|---|
| `?mode=mock` / `?mode=live` | Force the video source. |
| `?res=1080p` | Send `set_resolution` before `start`. Offered tiers are reported in the log (e.g. `1080p, 2k, 4k`). |
| `?emulate=quest3` | Desktop only: install IWER's Meta Quest 3 runtime. Ignored when native `immersive-vr` is available. |

An acknowledged `set_prompt` means the model accepted the prompt. The visible change follows at a later chunk boundary.

## Diagnostics

The in-headset HUD (below the video plane) shows:

```text
fps <render>  dec <decoded>  tex <uploads>/s  media +<s>/s  ctrl <inputs>  <width>x<height>
```

| Signal | Meaning |
|---|---|
| `fps` | XR frames rendered per second |
| `dec` | Frames decoded by the `<video>` element per second |
| `tex` | Texture uploads per second; should equal `dec` |
| `media` | Media time advanced per second (≈1 while playing) |
| `webrtc in` (panel) | Received fps, bitrate, packet loss, RTT, ICE candidate type |

This separates three failure modes:

| Observation | Diagnosis |
|---|---|
| `fps` low | Render loop throttled (hidden page or overloaded device) |
| `dec` low, `tex` ≈ `dec` | Source or network delivery (logged as `SOURCE slow`) |
| `dec` healthy, `tex` ≈ 0 | Texture stall; a ≤30 Hz upload fallback engages automatically |

Each XR session ends with a summary line, e.g. `immersive session ended — 94s in XR, 643 texture uploads (avg 6.8/s), stalled 0s, min render 69.7 fps, fallback=false`.

## Project structure

```text
app/
├── api/reactor/token/route.ts      Session-scoped JWT broker (from the reference app)
├── lib/token.ts                    Memoizing JWT resolver shared by / and /mvp
└── mvp/
    ├── page.tsx                    Server entry; checks key presence only
    ├── MVPApp.tsx                  Wiring: provider, video elements, selection, XR watchdog
    ├── components/
    │   ├── XRScene.tsx             Three.js renderer, WebXR session, scene, HUD
    │   └── DevPanel.tsx            Desktop diagnostics and controls
    └── lib/
        ├── orbisSession.ts         Sole Reactor-facing module: start-once, steer, errors, stats
        ├── videoBridge.ts          MediaStream → <video> binding and playback
        ├── videoTextureHealth.ts   Render/decode/texture watchdog and upload fallback
        ├── controllerInteraction.ts  XR controller/hand raycast, select, haptics, mouse fallback
        ├── xrEmulation.ts          Optional IWER Quest 3 emulation
        ├── mockSource.ts           Labelled mock canvas stream
        ├── debugState.ts           Diagnostics store and event log
        └── prompts.ts              Prompts, control definitions, cooldown
middleware.ts                       Optional HTTP Basic Auth
docs/
├── testing/                        Desktop, emulator, and Quest 3 device test reports
└── upstream-reactor-template.md    Original reference-app README
```

## Known limitations

- **Stream frame rate drops during a session.** In both desktop and Quest runs, delivery started at 18 fps and later fell to 0–7 fps while rendering stayed at full rate. On desktop, 1080p delivery (`?res=1080p`) gave about three times the frame rate of 2K at similar bandwidth.
- **No in-VR exit control.** Exit uses the system Meta button. The page's **EXIT VR** button is not visible inside VR.
- **Audio is disabled.** The `main_audio` track is not played.
- **No automatic retry at capacity.** A `429` capacity response requires pressing **Connect** again.

## Acknowledgements

- Visko for the Orbis live world model.
- [Reactor](https://reactor.inc) for `create-reactor-app`; this project is built on its `visko-orbis-stable` template (Apache-2.0).
- [Three.js](https://threejs.org/) and the W3C Immersive Web Working Group.
- Meta for the [Immersive Web Emulation Runtime](https://meta-quest.github.io/immersive-web-emulation-runtime/) and WebXR documentation.
- The Immerse the Bay 2026 organizers.

Team members are listed on the [Devpost project page](https://devpost.com/software/hero-ktaups).

## License

Licensed under the [Apache License 2.0](LICENSE). Portions are derived from Reactor's `create-reactor-app`; see [NOTICE](NOTICE).
