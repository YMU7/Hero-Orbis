# Princess rescue script

The room layout remains editor-authored. Rescue mechanics and progression live in
`app/puzzle/lib/rescueRoom.ts`; story lines and Orbis cues are in
`rescueDialogue.json`; idle hints and reaction quips are in `rescueBarks.json`.

Sequence: hammer seal → draw a sword (optionally try the melting rack sword first)
→ the player's actual strokes peel off the easel as a solid crayon sword → touch
the rope with the sword → the princess conjures a fireball and sends it out of
the painting → catch/throw it at the rope OR ignite the drawn sword with it and
touch the rope with the flaming blade → box falls and shatters → photograph the
freed key (trying the physical key against the painting is optional) → put the
photo into the painting → key travels to a turning lock and gold cracks spread
→ princess asks for a hand → after her line finishes, touch the glowing handprint
with a hand/controller (or click it on desktop) → canvas washes into light, a
crown tumbles out, and the painting displays the player's frozen drawing in the
Royal Gallery → cheeky final line from the right, confetti and the existing timed
end card. The timer still starts when the silence breaks.

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
- Story speech waits for the existing shimmer/settle gate. Fireball emergence and
  the final hand interaction also wait for the actual queued voice completion.
  Reset invalidates both pending continuations.

## Hints and quips

- Per stage, two spoken hints play at 25 s and 55 s without progress (reset by
  any drawing attempt). The silent opening retains its existing plaque nudges.
- Bad drawings (only while she is waiting for a drawn sword) get a quip after the
  usual 2.5 s pause, at most every 8 s. Drawing before trying the rack sword
  succeeds directly. Reaching for the hanging box gets `box-poke`.
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

## 2026-11-15 puzzle and ending update

- Recognition waits until the pen is up and the artwork is unchanged for 0.65 s.
  The accepted strokes are copied, normalized into a forgiving fixed sword collider,
  and rendered as thick crayon geometry. Erasing the board preserves the reward
  and the ending artwork. The sword peels forward for 0.7 s; it can be grabbed early.
- Flame transfer works with a floating or held fireball. A caught and thrown ball
  uses swept contact to avoid passing through the rope between frames.
- Early photography earns a queued special line; the rejection is not required.
- Local lock, handprint, crown and gallery effects do not require exact model timing.
  The finale is staged in rescueFinale.ts, with a new helping stage before escaped.
- Generated with the existing Qwen VoiceDesign profile and seed 42. Clip durations:
  unmuted 26.0 s; rope 11.5 s; helping 7.1 s; clever-photo 4.2 s; escaped 11.1 s;
  hint-rope-2 3.8 s; hint-helping-1 3.4 s; hint-helping-2 3.8 s.
  Per-clip JSON sidecars record the exact text, voice profile and measured duration.
- Validation: TypeScript and 12 physics/interaction tests pass. New tests cover
  snapshot preservation, flaming sword, thrown fireball, early photography, final
  voice gating and reset cancellation. Browser visual verification was blocked by
  the Windows computer-use tool; live Orbis and physical Quest testing remain pending.
