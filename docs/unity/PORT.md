# Unity → Hero-Orbis WebXR migration

The workspace root is now the Hero-Orbis Next.js application. `origin` points to
`https://github.com/YMU7/Hero-Orbis.git`; `unity-origin` retains the old remote.
The migration branch is based on Hero-Orbis `main`. Local `main` merges that
history with the original Unity history, retaining the migrated WebXR tree and
the archived Unity source. No commits were pushed by the migration.

## Source preservation

The saved active Unity project is in `archive/2026-11-14-unity-webxr-port/`:
`Assets`, `Packages`, `ProjectSettings`, speech tools, notices, and its README.
Open that directory in Unity Hub to revisit the original. Generated caches in
the workspace root are ignored and are not needed to open the archive.
The earlier `archive/2026-11-14-original/` is retained unchanged.
The nested `Hero-Orbis/` clone is retained as an ignored local backup.

## Runtime mapping

| Active Unity behavior | WebXR implementation |
| --- | --- |
| `DrawingEasel` first visible pen stroke releases one royal sword | `UnityRoom`, `DrawingBoard`, `Crayon` |
| `WallMountedTool`, grabbable hammer/sword/pen | `PhysicalTool`, `ToolPhysics` |
| Dropped tools fall, collide, and can be grabbed again | Rapier fixed-step world, continuous collision detection, authored furniture triangle colliders |
| `HammerHead` only breaks `MuteLogo` | Swept hammer-head contact in `UnityRoom`; swords and pen do not activate sound |
| Red logo shards, impact sound, looping room ambience | `UnityRoom` mesh debris and WebAudio synthesis |
| `TrackedHands` optical joints, pinch hysteresis, tracking recovery | `HandInput`, locally generated `ArticulatedHand` glove meshes |
| `RoomLocomotion` | `RoomMovement`: 2 m/s head-relative movement, room boundary, smooth right-stick turn at 90°/s, 15% turn dead zone |
| Unity scene/editor builders | Hero room builders, scene JSON, and `/editor?scene=puzzle` |

Hero-Orbis's room, furniture, layout, editor, stream/session handling, sword
recognizer, style tuner, and painting color grade remain. The gramophone remains
in the room as a visual asset; sound activation now uses the Unity hammer puzzle.
A first mark earns the physical sword independently of recognition. Recognizing
a drawn sword still changes the live princess prompt, gated on sound by default.
Clear removes ink; Reset restores the whole room, tools, sound, and reward.

## Verification

Run `pnpm typecheck`, `pnpm test:interactions`, and `pnpm build`.
Regression checks cover ownership, unmounting, furniture collision, tracking loss,
regrabbing, one-time reward, hammer-only activation, hand pinch rearming, and
frame-rate-independent smooth turning around the tracked head.
Desktop mock-mode browser checks exercise drawing, sound activation, the happy
princess transition, and both narrow and desktop layout breakpoints.

Physical Quest hand feel and frame budget still need device testing. The glove
meshes are articulated procedural geometry, not skinned avatar hands. Grabs use
proximity/pinch; individual fingers do not exert simulated physical forces.
Tools use simplified collision shapes; locomotion is constrained by the shell,
not a full player-versus-furniture character controller. Live Orbis requires a
Reactor key and was not exercised during this migration.
