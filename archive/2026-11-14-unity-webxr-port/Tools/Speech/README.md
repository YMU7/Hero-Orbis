# Local dialogue speech

## Qwen3 princess voice

The newer engine is Qwen3-TTS 1.7B VoiceDesign. The character description and
audition text live in `qwen/princess.json`. It runs locally on CPU with float32
weights; expect generation to take longer than Piper on this laptop.

```powershell
.\Tools\Speech\Princess.ps1
.\Tools\Speech\Princess.ps1 -Text 'At last! Someone who can hear me.' -Output .\Tools\Speech\output\princess-greeting.wav
```

The default output is `output/princess-qwen.wav`, with a JSON file recording
the prompt and seed. VoiceDesign can vary between lines; the saved seed and
description help repeat experiments but do not guarantee a fixed speaker.
The Qwen Base cloning model is a separate option for locking an approved voice
to a reference recording later.

Software and weights are under `qwen/` and ignored by Git. No cloud speech API
is used. Source: https://github.com/QwenLM/Qwen3-TTS

## Piper voices

Piper portable Windows release **2023.11.14-2**, with three US English medium
voices: `lessac`, `ryan`, and `amy`. No Python install or GPU is required.
Amy and Ryan use the `v1.0.0` voice repository snapshot for compatibility;
Lessac uses the current model. All three have generated verified WAV previews.
The original Windows binary is from the archived rhasspy repository; active
Piper development has moved to OHF-Voice/piper1-gpl.

From the project root in PowerShell:

```powershell
.\Tools\Speech\Speak.ps1 -Voice lessac -Text 'Welcome. I have been waiting for you.' -Output .\Tools\Speech\output\welcome.wav
.\Tools\Speech\Speak.ps1 -Voice ryan -Text 'Who is speaking?' -Output .\Tools\Speech\output\reply.wav
```

Use `-LengthScale 1.15` for slower delivery or `0.9` for faster delivery.
Use `-Voice princess` for an Amy-based character preset with brisker
delivery (length scale 0.88). This is a starting voice for auditioning the
princess, not a separately trained model or an emotion-controlled performance.

```powershell
.\Tools\Speech\Speak.ps1 -Voice princess -Text 'Oh! A visitor. Tell me, what brings you to my tower?'
```

Give each dialogue line its own output filename; an existing output is replaced.
Copy approved WAV files into `Assets/Audio/Dialogue/` to import them into Unity.
Generated previews stay outside Assets so experiments do not trigger imports.

Runtime, models, and previews are ignored by Git. Model cards are downloaded
alongside each model; review their dataset license links before distributing
voices or using the resulting audio in a release.
Ryan's model card lists **CC BY-NC-SA 4.0**, including a noncommercial restriction.

Sources:
- https://github.com/rhasspy/piper/releases/tag/2023.11.14-2
- https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_US
- https://github.com/OHF-Voice/piper1-gpl

Each voice needs both its `.onnx` and `.onnx.json` files in `models/`.
The portable executable is at `runtime/piper/piper.exe`.
