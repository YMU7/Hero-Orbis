# Princess rescue script

The room layout remains editor-authored. Rescue mechanics and progression live in
`app/puzzle/lib/rescueRoom.ts`; story lines and Orbis cues are in
`rescueDialogue.json`; idle hints and reaction quips are in `rescueBarks.json`.

Sequence: hammer seal → grab rack sword and let it melt → draw a recognizable
sword → touch rope with the new sword → the princess conjures a fireball, which
floats out of the canvas → catch it and touch the rope ("Wow that actually
worked") → box falls and shatters → touch key to painting (it bounces back) →
photograph key → put photo into painting → fanfare, confetti, final line, end card
with the rescue time (measured from breaking the silence).

## Syncing the room with Orbis (~2 s delay)

Orbis applies a new prompt at the next chunk boundary (~1.8 s) after the
`set_prompt` ack, so the picture always lags the action. The script works with
that delay instead of fighting it:

- **Cues describe sustained states, not instant events.** "Holding a glowing
  fireball", not "throws a fireball". Each cue restates a calm expression and
  "The camera does not move", like the fixed prompt parts.
- **Lead, then react.** The fireball cue is sent when the rope line starts; the
  3D fireball leaves the canvas only after both the voice line and the morph
  have landed (`steerScript` resolves after the ack + 2 chunks, capped at 5 s).
  The `released` cue (hands empty, pointing at the viewer) then arrives ~2 s
  later, which reads as her reaction.
- **Shimmer covers the gap.** While a cue is in flight the painting ripples like
  wet paint with drifting gold glints (`paintingFx` in `roomParts.ts`), so the
  delay reads as magic rather than lag. Mock mode shows a 1.6 s shimmer.
- Voice lines start immediately at the action; nothing waits on a video chunk
  except the fireball's emergence.

## Hints and quips

- Per stage, two spoken hints play at 25 s and 55 s without progress (reset by
  any drawing attempt). The silent opening gets a plaque nudge at 20 s.
- Bad drawings (only while she is waiting for a drawn sword) get a quip after the
  usual 2.5 s pause, at most every 8 s. Drawing a sword before trying the rack
  sword gets the `early-draw` line. Reaching for the hanging box gets `box-poke`.
- Barks never interrupt: they are dropped (and hints retried) while she talks.
- The subtitle clears 2.5 s after the last line; the plaque then shows the
  current objective.

Desktop: click a tool to carry it at the center of view; click again to drop.
Use WASD and arrow keys to move/aim. Space fires the held camera. In VR, grip or
pinch tools; use the controller trigger while holding the camera, or pinch near
the camera with the other hand to operate its shutter. Reset restores all props
and stops dialogue. The sword reward requires recognition, not an arbitrary mark.

All WAV clips in `public/audio/princess` use the saved Qwen VoiceDesign princess
description and seed 42, with provenance in `voice.json`. Regenerate missing
clips (existing WAVs are skipped) with the bundled interpreter:

```
archive/2026-11-14-unity-webxr-port/Tools/Speech/qwen/python/cpython-3.12-windows-x86_64-none/python.exe scripts/generate-princess.py
```

(The `.venv` launcher in that folder points at a moved interpreter and fails.)

Verification: rescue physics integration (including fireball emergence and the
burn-triggered line), drawing recognizer, tracking-loss release, smooth turning,
TypeScript. In mock mode in the browser: subtitle clearing, stage objectives,
idle hints, and the shimmer were checked. Live Orbis cue wording and timing, and
physical headset interaction (haptics, camera flash, end card), still require an
on-device playthrough.
