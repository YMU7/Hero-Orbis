# A Poor Choice of Words

A Unity 6 PCVR graybox of the five-puzzle princess rescue. Includes desktop
controls, OpenXR controller input, 47 generated voice lines, subtitles, optional
jokes, inactivity hints, tolerant charcoal drawing and a final door/rescue reveal.
The painting uses a public-domain princess portrait. There is no Orbis integration.

## Open and play

Unity **6000.0.66f2**, built-in render pipeline. On Zac's NixOS setup:

```sh
bash Tools/unity.sh editor
```

Sign in and activate a license in Unity Hub first. Package Manager installs the
pinned dependencies on first import. The editor setup configures the PC OpenXR
loader and Touch / Index / Vive profiles automatically. Open
`Assets/Scenes/Gallery.unity` and press **Play**, then **Enter the gallery**.
The scene is intentionally empty in Edit mode; the room is constructed at runtime.
If needed, run **Poor Words → Configure PCVR project** and restart the editor
when Unity requests an input-backend change.

With an active OpenXR runtime and connected headset, tracking and controller
input are used automatically. Without one, the same scene uses desktop controls.
Windows PCVR is the headset target. On Linux, automatic XR startup is disabled:
Unity's standard OpenXR package does not include a native Linux library. Linux
Editor and Linux builds therefore run in desktop mode. A community Linux XR
provider could use the same input rig, but none is bundled or validated here.
Standalone Quest/Android packaging is not configured.

| Action | Desktop | VR |
| --- | --- | --- |
| Move / look | WASD / mouse | Left stick / head |
| Turn | Mouse | Right stick, 30° snap |
| Take tool | Click tool | Grip near tool or while pointing |
| Drop tool | F | Release grip |
| Use tool / interact | Point and click | Point and trigger, or touch with held tool |
| Draw | Hold click with charcoal | Hold trigger and point, or touch with charcoal tip |
| Rotate sword | Hold R | Rotate wrist |
| Tool distance | Mouse wheel | Move hand |
| Crouch | Hold C | Physical / use ray at a distance |
| Hint / repeat | H / T | Visitor services panel / listen with subtitles |
| Lost tools | Backspace or menu | Visitor services panel |
| Menu / transcript | Esc / Tab | Visitor services panel |

Either controller can take any tool. All critical tasks also accept a remote
pointing interaction, including sword placement and crank activation, so no task
requires simultaneous two-handed interaction. The board and frame accept coarse
strokes; Trace Assist accepts one mark per required sword region or frame side.
World subtitles follow the headset and remain on when the voice is muted.

## Walkthrough / verification route

1. Ring the bell for the silent assistance card. Take the hammer; strike SILENCE.
   Iris speaks. The bell-dependent line only plays if it was actually rung.
2. Try the real sword on the red ribbon for the anticipated mistake. Take charcoal,
   draw the faint sword's long blade and crossing guard on the left board. A new
   charcoal sword appears at the bench. Take it and cut the ribbon.
3. Try striking the knight with the charcoal sword for the blocking joke. Remove
   K from the brass KNIGHT letters, leaving NIGHT. Other letters can be removed
   and returned from the tray. The light changes and the guard goes off shift.
4. Try the crank first for the biscuit bridge. Take the charcoal sword; point at
   the two brackets below the painting and click/trigger to snap it across them,
   or release it close to the supports. Turn the crank again to cross.
5. With charcoal, trace the painting's four outer edges. Draw a short handle mark
   in the dark recess on its right side. Pull the new handle to swing the whole
   painting open. A stock-mesh Iris stand-in emerges for the farewell.

During puzzle five, tracing a rectangle near the workbench board's perimeter
produces the tiny wrong door. Marking the interior of the painting gives the
wrong-prison feedback. Hints advance after 45 seconds of inactivity, or on request;
active experimentation resets inactivity. Repeated attempts do not repeat jokes.
Solving NIGHT early is remembered and honored when the knight appears.

## Implementation

- `PuzzleState.cs`: ordered, idempotent, engine-independent state and trace coverage.
- `GalleryGame.cs`: puzzle triggers, drawing acceptance, local effects, hint ladder,
  dialogue priorities, reveal and session telemetry in the Unity log.
- `GalleryBuilder.cs`: runtime graybox scene, stock meshes, portrait and targets.
- `PlayerRig.cs`: shared desktop / XR input, grabs, pointer use, locomotion.
- `Pickup.cs`: held tools, contact interaction, recoverable physics and bridge lock.
- `DialogueDirector.cs`: actual audio playback, subtitle duration, interruptions,
  optional-comment cooldown and conversation history.
- `Tools/make_dialogue.py`: editable dialogue source and regeneratable TTS.
- `Assets/Editor/ProjectSetup.cs`: idempotent PCVR setup and Linux build command.

Progression is independent of dialogue and artwork. `PuzzleState.Changed` is the
future integration hook for Orbis; no rendering/network event owns puzzle success.
Changes to text belong in `Tools/make_dialogue.py`, followed by regeneration.

```sh
uv run --with edge-tts python Tools/make_dialogue.py --audio
python3 Tools/make_sfx.py
bash Tools/unity.sh test
bash Tools/unity.sh test-play
bash Tools/unity.sh build-linux
# With Windows build support installed:
bash Tools/unity.sh build-windows
```

`ffmpeg` must be available for neural TTS conversion. Existing WAVs are reused;
pass `--force` to regenerate them. To use offline TTS, pass `--espeak /path/to/espeak-ng`.
The Linux build is a desktop player; the Windows build enables OpenXR.
The player runs offline once the packages have been imported and a build made.

Unity tests cover the ordered rescue, duplicate/invalid actions, early and wrong
letter combinations, art-only tools, bridge prerequisites, door prerequisites,
and coarse versus interior drawing coverage. See `VALIDATION.md` for checks
actually executed in this environment.

## Prototype boundaries

The room and props are graybox geometry, not finished imported environment art.
The portrait remains a still throughout; local geometry and light changes convey
progress. The rescued character is a primitive stand-in. There is no lip sync,
Orbis client, combat, save-to-disk, or production character animation. Progress and
conversation history persist for the current session; exiting Play resets them.
The 5–10 minute target and VR comfort still need human playtesting. Desktop and
headset validation are recorded separately in `VALIDATION.md`.

Asset provenance is in `THIRD_PARTY.md`.

For license-free state checks: `bash Tools/test-logic.sh` (Mono, curl, Python; fetches NUnit 3.14).
For bundled asset checks: `python3 Tools/check_assets.py`.
