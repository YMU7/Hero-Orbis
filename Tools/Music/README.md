# Local demo soundtrack generation

Stable Audio 3 Medium (1.4B), using the official Windows LiteRT/XNNPACK CPU runtime,
8-bit DiT, and the larger SAME-L audio decoder. No CUDA or GPU is used.
Selected for current instrumental soundtrack quality with a supported CPU path.
This is a strong local option, not a claim that it wins every music benchmark.

From the project root in PowerShell:

```powershell
.\Tools\Music\Generate-Music.ps1
.\Tools\Music\Generate-Music.ps1 -Prompt 'Uplifting cinematic electronic instrumental, magical bells, warm strings, adventurous, 110 BPM, no vocals' -Seconds 60 -Seed 42 -OutFile 'demo-60s.wav'
```

WAV files are saved in `Tools/Music/output/` (44.1 kHz, stereo PCM).
The default is a 30-second fantasy adventure cue for the Hero-Orbis demo.
Use a different seed for variations. Maximum supported duration is 380 seconds;
start with 20–30 seconds because longer renders cost more CPU time.
The launcher uses 8 threads by default; `-Threads 4` reduces CPU contention.

Verified on this Windows PC: the default 30-second cue generated successfully
in 56.78 seconds on CPU (8 threads, 8 sampling steps, seed 2026), excluding
downloads. Output: `output/hero-orbis-demo.wav`. Checked stereo, 44.1 kHz,
exactly 30 seconds, finite samples, and non-silent output. Musical quality has
not been assessed by listening; audition the sample before using it in the video.

The runtime, environment, model cache, and outputs are ignored by Git.
Dependencies are isolated in `stable-audio-3/optimized/tflite/.venv`.
That environment reuses the Python 3.12 installation in the archived speech tools;
keep that installation present. Exact installed packages are in `requirements-lock.txt`.
Models download on first use into this folder's `cache/huggingface` and are
hardlinked into the runtime where supported, avoiding duplicate model storage.
LiteRT also creates CPU weight caches on first load.

## Provenance

- Runtime: https://github.com/Stability-AI/stable-audio-3/tree/main/optimized/tflite
- Installed source commit: `790793b89ddceea612be9ce42ff6830d18f6fa57`
- Model repository: https://huggingface.co/stabilityai/stable-audio-3-optimized
- Components: `tflite/t5gemma/encoder_fp16.tflite`,
  `tflite/sa3-m/dit_w8a8.tflite`, `tflite/same-l/dec_w8a8.tflite`
- Model terms: https://stability.ai/license (Stability AI Community License).
  Consult the linked terms before publishing or commercial distribution.

The larger Stable Audio 3 Large model is API-only. The Medium fp32 weights would
exceed this machine's initial free space once dependencies and caches are included;
the official 8-bit CPU variant is used here.
