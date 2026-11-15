# Third-party assets and software

## Princess portrait (bundled)

`Assets/Resources/Art/Princess.jpg`

Jean Auguste Dominique Ingres, *Princesse de Broglie*, 1851–53.
The Metropolitan Museum of Art, Robert Lehman Collection, 1975, accession 1975.1.186.
The Met marks this image as public domain (`isPublicDomain: true`).

- Object: https://www.metmuseum.org/art/collection/search/459106
- Open Access API: https://collectionapi.metmuseum.org/public/collection/v1/objects/459106
- Image: https://images.metmuseum.org/CRDImages/rl/web-large/DP-19264-001.jpg
- Open Access policy: https://www.metmuseum.org/policies/image-resources

The pictured historical princess is a generic placeholder for Iris. This is a still image; no Orbis dependency or API key is needed.

## Temporary voice recordings (bundled)

`Assets/Resources/Voice/*.wav`: synthesized with Microsoft Edge TTS, voice
`en-GB-SoniaNeural`, at -5% speaking rate, using the open-source `edge-tts` client
(https://github.com/rany2/edge-tts, LGPL-3.0). The client is a generation tool and
is not shipped inside the Unity player. These are temporary prototype voice
assets; the generated dialogue text is in `Dialogue.json`. No voice cloning.

`Tools/make_dialogue.py` can also generate locally with eSpeak NG.

## Placeholder room, props, character and sound

Room, props, knight and rescue figure use Unity's built-in primitive meshes.
They are intentionally graybox assets, not imported custom character models.
The seven short placeholder sound effects are original procedural waveforms
created by `Tools/make_sfx.py`; those audio files are dedicated to CC0.

## Runtime packages

Unity Input System, XR Management, OpenXR and Unity Test Framework are installed
by Package Manager from the pinned manifest. Their licenses are included in the
corresponding packages, and are not replaced by this file.
