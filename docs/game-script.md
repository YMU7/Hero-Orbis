# HERO — Princess Rescue: Game Script

> Historical 2026-11-14 script. The current 2026-11-15 branching puzzles,
> final hand interaction, dialogue timings and verification notes are in
> [rescue-script.md](rescue-script.md); exact current lines are in
> `app/puzzle/lib/rescueDialogue.json`.

Exported from the live game code (`rescueRoom.ts`, `unityRoom.ts`, `PuzzleApp.tsx`,
`rescueDialogue.json`, `rescueBarks.json`, `puzzleConfig.ts`) on 2026-11-14.

## Legend

| Marker | Meaning |
|---|---|
| `▶ ACT` | Player action or game event (physics, props, sound, haptics) |
| `💬 SAY` | Princess story line: a recorded voice clip plus subtitle, always plays |
| `💡 HINT` | Idle hint: spoken (or written on the plaque) only if the player is stuck |
| `😏 QUIP` | Reactive line: spoken when the player does something specific |
| `🎨 ORBIS` | Prompt sent to Orbis to steer the live video in the painting |
| `🪧 PLAQUE` | Objective text shown on the plaque under the painting when nobody is talking |

**How the timing works**
- Story lines (`SAY`) queue up, so they never talk over each other.
- `HINT` and `QUIP` lines are skipped if she is already talking. A skipped idle hint tries again 4 s later.
- Idle hints fire **25 s** (gentle) and **55 s** (blunt) after entering a stage. Each new crayon stroke restarts the timer.
- Each `ORBIS` cue goes out the moment its action happens. The painting shimmers until the new picture is on screen, which takes about 2 chunks and never more than 5 s.
- Orbis audio is turned off. All princess speech comes from the WAVs in `public/audio/princess/`.

**Fixed Orbis prompt prefix.** Every `ORBIS` cue below is appended to this text:

> *Style:* Cute stylized 3D fantasy animation with a whimsical fairytale diorama feel: soft rounded shapes, smooth matte stylized materials, warm hazy morning sunlight, soft diffused frontal light on faces, gentle soft shadows, gentle contrast and a soft, muted, low-saturation pastel palette of powder blue, warm ivory, dusty lavender and pale soft gold, with creamy highlights.
> *Identity:* A cheerful young girl princess with youthful, cute, childlike cartoon proportions … short golden-blonde wavy bob, small pale-gold crown, layered royal gown in powder blue and warm ivory with pale gold star embroidery, cream puff sleeves …
> *Setting:* She stands outdoors on a sunlit fairytale garden terrace with pale lavender flowers and dusty-blue hydrangeas, a small waterfall and a distant pastel castle with pointed towers under a pale hazy sky …
> *Camera:* Static camera, eye-level medium shot framing the princess from the waist up, centred in frame, facing the camera …

(The full text is in `app/puzzle/puzzleConfig.ts`, and it can be overridden in the Style Tuner via `data/puzzle-style.json`.)

---

## 1 · Silence

🎨 ORBIS: She looks at the viewer with a sad, hopeful face and opens and closes her small mouth as if trying to speak without a sound, then gently taps her lips with one finger.

▶ ACT: The room is silent. A red mute seal under the painting pulses and glows. A hammer hangs beside the painting, and a sword hangs on the wall rack.

🪧 PLAQUE: *She is trying to speak… break the silence.*

💡 HINT (plaque, after 20 s): *That red seal under the painting looks fragile… try the hammer.*

▶ ACT: The player swings the hammer into the mute seal. The seal shatters into 28 red shards with a glass-break sound and a strong haptic pulse. Room ambience fades in, and the rescue timer starts.

## 2 · Unmuted

🎨 ORBIS: Her face lights up with a big bright smile; she gives cheerful little hops and claps her small hands with joy.

💬 SAY: "Thank you hero! When I found out I would be voiceless until someone broke the silence, I didn't think that this is what they meant. I was trapped here by an evil witch when I criticized her artwork. To be fair it was really awful. Anyways, time to rescue me. Draw your sword!"

🪧 PLAQUE: *Draw your sword, hero!*

💡 HINT (25 s): "Go on, hero. There's a sword hanging on the wall, right beside me!"
💡 HINT (55 s): "The sword! On the wall! Just grab it!"

😏 QUIP (the player draws a valid sword on the easel before trying the rack sword; once per run): "Ooh, lovely! But shouldn't a hero try the real sword first? It's on the wall."

▶ ACT: The player grabs the sword from the rack. After 1.2 s the blade starts to droop, and by 2 s it has melted flat. It then snaps back onto the rack, whole again.

## 3 · Melted

🎨 ORBIS: She tilts her head with a small puzzled pout and rests one finger on her chin, looking thoughtful.

💬 SAY: "Hmm, I know the hero is supposed to draw a sword to save me. But that doesn't seem to be working. What else could you try?"

🪧 PLAQUE: *There must be another way to draw a sword…*

💡 HINT (25 s): "There's an easel and a crayon over there. Maybe you could draw a sword?"
💡 HINT (55 s): "Draw. A. Sword. On the easel, hero!"

▶ ACT: The player draws on the easel with the crayon. Each stroke is checked by the sword recognizer.

😏 QUIP (bad doodle, 2.5 s after the last stroke; at most one every 8 s; first one if the drawing is too short/small): "That's a little small for a sword. Bigger, hero!"
😏 QUIP (bad doodle, rotating):
- "Hmm. Is that a baguette?"
- "I've seen scarier butter knives."
- "Even the witch draws better than that. Try again!"

▶ ACT: The recognizer accepts the drawing. A success chime plays, and a real sword pops out of the easel and drops into the room.

## 4 · Drawn

🎨 ORBIS: She giggles happily with one small hand over her mouth, her shoulders bouncing, amused and delighted.

💬 SAY: "Well that wasn't what I had in mind but it worked! Now we need to get the key out of that box. You can probably smash it on the floor."

🪧 PLAQUE: *Free the key from the box.*

💡 HINT (25 s): "That box is hanging from a rope. Try your shiny new sword on it!"
💡 HINT (55 s): "Swing your sword at the rope above the box!"

😏 QUIP (the player grabs the hanging glass box; at most once every 12 s, any stage after silence): "It's tied up, silly. Deal with the rope first!"

▶ ACT: The player swings the drawn sword at the braided rope that holds the glass key box. A hit counts anywhere within 0.6 m of the blade. The rope does not cut.

## 5 · Rope

🎨 ORBIS: She cups her small hands together in front of her chest, and a round glowing orange fireball floats between her palms, casting warm flickering firelight on her face and gown; she gazes at it with excited wonder.

💬 SAY: "Oh yeah I forgot, that is special sword-proof rope. Can't cut it. I wonder if this will work... we need something to catch fire!"

▶ ACT: Once her line ends and the picture shows the fireball, there is a 1.5 s pause. An orange portal ripple then spreads across the canvas, and the fireball floats out of the painting into the room over 0.9 s.

🎨 ORBIS (cue only, no voice): Her small hands are open and empty in front of her; she points eagerly toward the viewer and bounces on her toes with excitement.

▶ ACT: The fireball drifts back and forth in front of the painting until someone catches it.

🪧 PLAQUE: *Something needs to catch fire…*

💡 HINT (25 s): "Catch my fireball! Don't worry, it won't burn you."
💡 HINT (55 s): "Grab the fireball and hold it against the rope!"

▶ ACT: The player catches the fireball (catch sound + haptic) and touches it to the rope. The rope burns away in a burst of embers with a snap sound, and the glass box falls.

## 6 · Fire

🎨 ORBIS: She gasps with delight, her big eyes wide and sparkling, both small hands pressed to her rosy cheeks.

💬 SAY: "Wow that actually worked. I like this game."

🪧 PLAQUE: *The box is falling!*

▶ ACT: The glass box drops under gravity and shatters on the floor. Crystal shards scatter, and the golden key lies free to pick up.

## 7 · Key

🎨 ORBIS: She claps with delight and beams, then leans toward the viewer with both small hands held out, waiting expectantly.

💬 SAY: "Okay, now get that key into the picture."

🪧 PLAQUE: *Get the key into the picture.*

💡 HINT (25 s): "Bring the key up to me. Right here, to the picture!"
💡 HINT (55 s): "Touch the key to the picture, hero!"

▶ ACT: The player pushes the key against the painting. A blue ripple spreads across the canvas, a rejection sound plays with a haptic jolt, and the key is knocked out of the player's hand and bounces back into the room.

## 8 · Rejected

🎨 ORBIS: She gives a small sympathetic wince, then a brave encouraging nod, one small hand still held out toward the viewer.

💬 SAY: "I was worried about that. But we need that key in the picture."

🪧 PLAQUE: *Get the key into the picture… somehow.*

💡 HINT (25 s): "If only we had a picture of the key. Is that a camera over there?"
💡 HINT (55 s): "Pick up the camera and take a photo of the key!"

▶ ACT: The player picks up the camera from beside the painting and fires the shutter: controller trigger, a pinch with the other hand, or Space on desktop. Each shot flashes and clicks. At this stage, a shot counts if it is aimed within 0.5 m of the key. A photograph of the key then pops out of the camera.

## 9 · Photo

🎨 ORBIS: She holds out both open hands toward the viewer, her big eyes wide with hopeful excitement, smiling.

💬 SAY: "Excellent."

🪧 PLAQUE: *Bring the photograph to the painting.*

💡 HINT (25 s): "Ooh, a photograph! Now bring it to me."
💡 HINT (55 s): "Put the photo into the picture, hero!"

▶ ACT: The player presses the photo into the painting. A large gold ripple spreads, the photo is absorbed, and a portal sound and fanfare play. Every controller pulses, and confetti bursts from the top of the painting.

## 10 · Escaped

🎨 ORBIS: She holds up a small shining golden key in one hand and beams with joy, waves goodbye to the viewer, then turns and skips happily away along the garden path toward the distant castle.

💬 SAY: "I'm free! Thank you, hero. And just between us... your sword drawing was even worse than the witch's art."

🪧 PLAQUE: *The princess is free!*

▶ ACT: When her line ends, an end card rises under the painting with the text **The Princess Is Free!**, *Rescued in M:SS*, "Thank you for playing HERO" and "Press RESET on the pedestal to play again".

▶ ACT (Reset): All props, voice and Orbis go back to Stage 1.

---

## Script vs. game: open notes

- **"Smash it on the floor"** (Stage 4 line): the player can't actually smash the box. It can't be grabbed, and it only falls once the rope burns. The line works as misdirection, but it contradicts the Stage 4 hints, which point at the rope.
- **Locked door ending**: the original outline had her unlock a door and leave the castle. The painting is now an outdoor garden, so the final cue has her skip off toward the distant castle. She already holds the key, but no door appears.
- **Fireball**: the outline had a fireball spawn by itself. Now she conjures it in the painting first (Stage 5 cue), and it then floats out of the canvas.
