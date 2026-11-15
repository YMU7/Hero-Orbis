# Princess rescue script

The room layout remains editor-authored. Rescue mechanics and progression live in
`app/puzzle/lib/rescueRoom.ts`; lines and Orbis cues are in `rescueDialogue.json`.
The incomplete `# the` cue is interpreted as the princess looking thoughtful.
Dialogue and steering dispatch on the triggering action, without waiting for
voice completion or a video chunk. Clips may overlap if actions happen quickly.
Only the sword melt (two seconds), falling box, and other physical animations use
elapsed time. Reconnecting preserves the latest Orbis instruction.

Sequence: hammer seal → grab rack sword and let it melt → draw a recognizable
sword → touch rope with the new sword → catch moving fireball and touch rope →
box falls and shatters → touch key to painting → photograph key → put photo into
painting. The camera accepts an aim within 0.5 m of the key. The final Orbis cue
asks the princess to pick up the key, unlock the door, and leave the castle.

Desktop: click a tool to carry it at the center of view; click again to drop.
Use WASD and arrow keys to move/aim. Space fires the held camera. In VR, grip or
pinch tools; use the controller trigger while holding the camera, or pinch near
the camera with the other hand to operate its shutter. Reset restores all props
and stops dialogue. The sword reward requires recognition, not an arbitrary mark.

Eight WAV clips are included in `public/audio/princess`. They use the saved Qwen
VoiceDesign princess description and seed 42, with provenance in `voice.json`.
Regenerate with the bundled Python runtime and `scripts/generate-princess.py`;
the script reuses the archived model and skips existing WAVs.

Verification: full rescue physics integration, drawing recognizer, tracking-loss
release, smooth turning, TypeScript, and production build. Live Orbis output and
physical headset interaction still require an on-device playthrough.
