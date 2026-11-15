# Immerse the Bay 2026 — XR starter

Fresh Unity **6000.6.9f1** project using Universal Render Pipeline, OpenXR,
Input System, and XR Interaction Toolkit. Targets Windows PCVR.

Open this repository folder in Unity Hub, let packages import, then open
`Assets/Scenes/XRStart.unity`. Connect a headset with an active OpenXR runtime
and press Play. The scene has a floor, light, XR Origin, tracked camera, tracked
controller transforms, and XR Interaction Manager, plus an 8 × 12 × 4 m room.
A framed princess portrait hangs at the center of the far wall, with a hammer,
sword, and pen on a rack alongside it. Reusable grabbable prefabs are in
`Assets/Prefabs/`.

Left stick moves; right stick snap-turns. Point either controller at a tool and
hold either grip or trigger to bring it into your hand; release to drop it with physics.
The tool comes off its mount on the first grab.

Optical hands use XR Hands and the OpenXR Hand Tracking Subsystem, enabled on
editor import (or **XR → Configure hand tracking**). On a compatible runtime,
both hands appear as articulated colored joint/bone visuals. Bring an open hand
near a tool, pinch thumb and index to grab, and open to release. Pinch uses separate
close/release thresholds to resist jitter. Tracking loss hides the hand and
releases its object; open your fingers before grabbing again. Controller rays
resume when optical tracking is unavailable. These visuals are skeletal, not
skinned hand meshes. Hand colliders provide grab proximity, not finger physics.

PCVR optical hand availability depends on the headset and OpenXR runtime exposing
`XR_EXT_hand_tracking`; controller tracking alone does not provide finger joints.

An easel stands to the left of the princess. Touch the canvas with the pen nib
and move it even slightly to draw a mark and release a royal sword. The reward
falls out once per Play session and can be grabbed like the wall tools. It has
a longer, wider blade, a gold guard, sapphires, and glowing blue inlays.
Use **XR → Validate drawing easel** for the drawing/reward smoke check.

The microphone symbol under the portrait starts muted. Touch it with the hammer
head to shatter the red circle/slash, hear the break, reveal an active microphone
indicator, and start synthesized room background noise. Sword and pen contacts
do not activate it. Restart Play mode to reset. This controls game ambience only.

Use **XR → Build portrait room** to rebuild the room and tools. This replaces the
room's contents. The Play mode smoke check is `RoomInteractionValidation.Run`
(run through Unity's `-executeMethod` command-line option, without `-quit`).

OpenXR starts automatically for Standalone. Oculus Touch, Valve Index, and Vive
controller profiles are enabled. Quest standalone/Android is not configured.

The scene and XR settings are generated on first editor import. To explicitly
recreate the starter scene, use **XR → Create fresh starter scene** (this replaces
the starter scene, so save any work elsewhere first).

The previous project, including its uncommitted changes and generated local
files, is preserved in `archive/2026-11-14-original/`. Its `Assets` folder stays
outside the active Unity Assets folder. Git history remains in the repository.
