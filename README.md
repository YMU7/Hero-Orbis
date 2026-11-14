# Orbis × WebXR MVP (Meta Quest 3)

Smallest vertical slice: a **live** Visko Orbis Stable `main_video` WebRTC
stream drawn on a `THREE.VideoTexture` plane inside an **`immersive-vr`**
session in **Meta Quest Browser**. You steer it with the Quest 3 controller
ray and trigger, which sends `set_prompt` on the **same** session with no
`start`/`reset` per change.

This app is a copy of the official reference app
[`create-reactor-app/templates/visko-orbis-stable`](https://github.com/reactor-team/create-reactor-app)
(Next.js 15, `@reactor-models/visko-orbis-stable@2.3.0`, `@reactor-team/js-sdk@3.0.0`, `three@0.187`).
The original desktop app is still at `/`. The MVP is at **`/mvp`**. The
reference README is kept as `README.reference.md`.

> Test status lives in [`TEST_REPORT.md`](TEST_REPORT.md). **Nothing has been
> tested on a physical Quest 3 yet.** The XR results so far come from Meta's
> IWER emulator.

## Install and run

Requires Node 20+ and pnpm 10.

```bash
pnpm install
cp .env.example .env        # then set REACTOR_API_KEY=rk_... (server-side only)
pnpm build
pnpm start                  # http://localhost:3000/mvp
```

On Windows, if `next build` fails with `EXDEV ... nextjs-nodejs\Config\config.json`,
set `NEXT_TELEMETRY_DISABLED=1`.

| Var | Required | Purpose |
|---|---|---|
| `REACTOR_API_KEY` | for live mode | Read only by `app/api/reactor/token/route.ts`. Never sent to the browser. |
| `BASIC_AUTH_USER` / `BASIC_AUTH_PASS` | recommended when tunneled | HTTP Basic Auth on every route (`middleware.ts`), including the token minter. |
| `ALLOWED_DEV_ORIGINS` | only for `pnpm dev` via LAN or tunnel | Hosts Next 15's dev server should accept. |

Without `REACTOR_API_KEY`, `/mvp` runs in **MOCK mode only**.

## Running on Meta Quest 3

WebXR needs a secure context. `http://localhost` counts as secure, so the
simplest path is USB plus port forwarding, which Meta documents on its
[browser remote debugging](https://developers.meta.com/horizon/documentation/web/browser-remote-debugging/)
page.

1. Enable **Developer Mode** on the Quest and connect it over USB. Install
   Android Platform Tools, then run `adb devices` and check that it lists `device`.
2. On the PC, run `pnpm build`, then `pnpm start`.
3. Forward the port to the headset:

   ```bash
   adb reverse tcp:3000 tcp:3000
   ```

4. In **Meta Quest Browser** on the headset, open `http://localhost:3000/mvp?mode=mock`.
5. **Debug:** on the PC, open `chrome://inspect/#devices` in Chrome, find
   the Quest Browser tab, and click **inspect**. The app mirrors its event log
   to the console with the prefix `[mvp:…]`.

**Wireless alternative:** an HTTPS tunnel with a valid certificate, for example
Cloudflare quick tunnel (not installed here). Run `pnpm start`, then:

```bash
cloudflared tunnel --url http://localhost:3000
```

Set `BASIC_AUTH_*` first so the public URL can't mint tokens on your account,
then open `https://<random>.trycloudflare.com/mvp` in Quest Browser. Video
always flows over WebRTC directly between the headset and Reactor. Only the
page and the token request go through your server.

### Quest test steps

1. **MOCK first** (`?mode=mock`). **ENTER VR** should appear, the plane
   should keep animating inside VR, and pulling the trigger on a 3D button
   should change the mock scene and give a short haptic tick.
2. Exit VR. Check the event log for the `immersive session ended — Ns in XR,
   N texture uploads (avg N/s), stalled Ns, min render N fps, fallback=…` line.
3. **LIVE**: switch to `LIVE ORBIS`, press Connect, and wait for `ready` and
   the first frames (the first chunk emits 0 frames while priming).
   Generation auto-starts. Enter VR.
4. Aim at **A · RAIN** and pull the trigger. Wait several chunks (~1.8 s
   each), then do the same for **B · NIGHT**. The headset HUD shows request,
   ack, and chunk.
5. Record the headset screen (Quest's own recording) and save the event log
   from `chrome://inspect`.
6. Fill in `TEST_REPORT.md` with the Quest OS / Browser version and what you saw.

## Using `/mvp`

- **Source toggle `MOCK` / `LIVE ORBIS`.** MOCK is an animated canvas
  delivered as a `MediaStream` through `canvas.captureStream()`, so it uses
  the same `<video>` → `VideoTexture` path as WebRTC. It's labelled
  **"MOCK — NOT LIVE ORBIS"** in every frame, on a 3D label, and in the HUD.
  In mock mode, steering changes only the canvas and sends nothing to Reactor.
- **Connect**, then **auto-start**: `set_prompt(initial)` → `start`, sent once
  per `sessionId`, after the first `state` snapshot shows `started=false`.
- **Steering**: Quest controller ray + **trigger** (the WebXR `select`
  event), Quest hand-tracking pinch (`generic-hand`, which also fires
  `select`), a desktop mouse click on the 3D buttons, or the panel buttons.
  Each press sends only `set_prompt`. Presses are blocked during the cooldown
  (default 4 s), while a previous send is in flight, or when that prompt is
  already requested.
- **"accepted (ack)"** means the model acknowledged `set_prompt`. It does not
  mean the picture has changed yet. The morph lands at a later chunk boundary.
- **`?emulate=quest3`** (desktop testing only) installs Meta's
  [IWER](https://meta-quest.github.io/immersive-web-emulation-runtime/)
  `metaQuest3` runtime, so desktop Chrome can open a real `immersive-vr`
  session with emulated Touch Plus controllers. It's ignored when native
  `immersive-vr` exists, so it never activates on a Quest. `window.__iwer`
  exposes the device for scripted tests.

## Does the video keep playing in immersive XR? (the watchdog)

three@0.187's `VideoTexture` uploads frames **only** from
`requestVideoFrameCallback` (rVFC) when the browser supports it. If a browser
stopped servicing rVFC while an immersive session owns the display, the plane
would freeze even though the `<video>` kept playing.
[`videoTextureHealth.ts`](app/mvp/lib/videoTextureHealth.ts) measures this
every second:

- **render fps**: frame-loop ticks (XR frames while presenting)
- **tex/s**: actual texture uploads
- **media +s/s**: how far `video.currentTime` advanced (is the element playing?)
- **FALLBACK**: if the video is playing but the texture gets no upload for
  600 ms, it forces uploads at up to 30 Hz.

It reports through the panel, the headset HUD (`tex N/s`), and the log:
`XR video: …` every 5 s, `VIDEO STALLED in XR` after 3 s of genuine stall,
and `XR render loop throttled` when the loop itself drops below 20 fps, which
it doesn't count as a texture stall. Exiting VR logs a per-session summary.

## Architecture

```
app/
  api/reactor/token/route.ts   official session-scoped JWT broker (unchanged)
  lib/token.ts                 memoizing JWT resolver, shared by / and /mvp
  mvp/
    page.tsx                   server: has-key check only
    MVPApp.tsx                 wiring: provider, video elements, selection → mock or steer, XR watchdog
    components/XRScene.tsx     Three renderer, VRButton, room, plane, buttons, HUD, setAnimationLoop
    components/DevPanel.tsx    desktop diagnostics + controls
    lib/orbisSession.ts        the ONLY Reactor-facing module: status, start-once, steer, errors
    lib/videoBridge.ts         MediaStream → app-owned <video>; play(); stats
    lib/videoTextureHealth.ts  in-XR texture/rVFC watchdog + upload fallback
    lib/controllerInteraction.ts  Quest controller/hand raycast + select + haptics, mouse fallback
    lib/xrEmulation.ts         dev-only IWER Quest 3 emulation (?emulate=quest3)
    lib/mockSource.ts          labelled MOCK canvas stream
    lib/debugState.ts          zustand diagnostics store + event log
    lib/prompts.ts             initial / rain / night prompts, button defs, cooldown
middleware.ts                  optional Basic Auth
```

- **One connection owner:** the reference app's typed
  `ViskoOrbisStableProvider`. `useViskoOrbisStableTrack("main_video")`
  returns the raw `MediaStreamTrack` from that session, and we bind it to our
  own `<video>`. There's no second `Reactor` instance and no reaching inside
  `ViskoOrbisStableMainVideoView`.
- **Typed `setPrompt()` / `start()`** send the same wire commands as
  `sendCommand('set_prompt')`, with type checking on top.
- **Command failures:** in js-sdk 3.x a refused command resolves `undefined`
  and fires the SDK `error` event (`operation: "sendCommand"`). The model also
  broadcasts `command_error`. Both are captured and shown in the panel and HUD.
- **Controllers:** no hard-coded profile IDs. The panel lists whatever the
  browser reports. Under IWER `metaQuest3` that's
  `meta-quest-touch-plus, oculus-touch-v3, oculus-touch, generic-trigger-squeeze-thumbstick`.
- **Audio is off** (the live `<video>` is muted).

## Known issues and risks

- **No physical Quest 3 test yet.** IWER emulates the WebXR API in desktop
  Chrome. It doesn't reproduce Quest Browser's media decoder, compositor, or
  rVFC scheduling, so the real answer to "does video keep playing in VR on
  Quest" still needs the device. The watchdog makes that answer visible.
- **Live Orbis is untested** until a `REACTOR_API_KEY` is configured.
- If the browser tab is hidden or backgrounded, Chromium throttles the frame
  loop to ~1 Hz. The watchdog labels this "render loop throttled", not a stall.
- The default delivered resolution is chosen by the deployment (e.g. 1080p).
  If Quest decode or upload cost shows up as low `tex/s` with a healthy render
  fps, the next step is `set_resolution` to the lowest offered tier before `start`.
- `/mvp` doesn't auto-retry on 429 (at capacity) the way the reference
  `StatusBadge` does. Press Connect again.
- Token edge case inherited from the reference app: a session created just
  before the memoized JWT expires gets orphaned at re-mint.
- There's no `pnpm lint` script (the template ships none). Type checking runs inside `pnpm build`.
