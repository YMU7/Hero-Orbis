# Validation — 2026-11-14

- Installed Unity Hub and Unity **6000.0.66f2** through the existing NixOS Unity
  module; the laptop rebuild and `unity-install-editor` both completed successfully.
- After license activation, `Tools/unity.sh setup` completed with exit code 0:
  Package Manager resolution, Unity C# compilation and PCVR configuration passed.
- Unity EditMode: **13 passed, 0 failed** (`Builds/test-results.xml`). The same
  state tests also passed independently under Mono/NUnit 3.14.
- Unity PlayMode: **1 passed, 0 failed** (`Builds/play-results.xml`). This test
  constructed the actual scene, used the hammer target, drew the sword on the
  rotated board, cut the ribbon, removed K, docked/lowered the sword bridge,
  traced the outer frame and handle, opened the painting and waited for Iris's
  emergence. It also verified that moving the voice to Iris doesn't move the frame.
- Asset validation: **47 voice WAVs**, 205.2 seconds total, **7 effects**, valid
  portrait, package manifest and assembly definitions.
- The main project was opened in the graphical Unity editor. Subsequent checks
  ran against an isolated project copy so they would not lock the user's editor.

The PlayMode run used Unity's null graphics device. A headset comfort/input
playtest and human assessment of puzzle timing remain pending. Windows PCVR is
configured; no Windows player or native Linux XR provider has been tested.
