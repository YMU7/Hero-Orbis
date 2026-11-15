"""Local Qwen3 voice design; default profile is the portrait's princess."""
import argparse
import json
import os
from pathlib import Path
import time

ROOT = Path(__file__).resolve().parent
os.environ.setdefault("HF_HOME", str(ROOT / "cache"))
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--text")
    parser.add_argument("--description")
    parser.add_argument("--output", type=Path, default=ROOT.parent / "output" / "princess-qwen.wav")
    parser.add_argument("--download-only", action="store_true")
    args = parser.parse_args()
    from huggingface_hub import snapshot_download
    model_dir = ROOT / "models" / "VoiceDesign"
    if not (model_dir / "download-complete.json").exists():
        print("Downloading official Qwen3-TTS VoiceDesign model...", flush=True)
        snapshot_download("Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign", local_dir=model_dir)
        (model_dir / "download-complete.json").write_text('{"source": "huggingface_hub"}', encoding="utf-8")
    if args.download_only:
        return
    import torch
    import soundfile as sf
    from qwen_tts import Qwen3TTSModel
    torch.set_num_threads(min(8, os.cpu_count() or 4))
    profile = json.loads((ROOT / "princess.json").read_text(encoding="utf-8"))
    torch.manual_seed(profile["seed"])
    print("Loading VoiceDesign on CPU...", flush=True)
    model = Qwen3TTSModel.from_pretrained(
        str(model_dir), device_map="cpu", dtype=torch.float32,
        attn_implementation="sdpa", local_files_only=True,
    )
    started = time.monotonic()
    print("Generating princess audition...", flush=True)
    with torch.inference_mode():
        wavs, sr = model.generate_voice_design(
            text=args.text or profile["text"], language="English",
            instruct=args.description or profile["description"], max_new_tokens=512,
        )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    sf.write(args.output, wavs[0], sr, subtype="PCM_16")
    info = sf.info(args.output)
    if info.frames == 0:
        raise RuntimeError("Generated audio is empty")
    print(f"Saved {args.output.resolve()} ({info.duration:.1f}s, {sr} Hz; generated in {time.monotonic()-started:.1f}s)", flush=True)
    args.output.with_suffix(".json").write_text(json.dumps({
        "model": "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign",
        "text": args.text or profile["text"],
        "description": args.description or profile["description"],
        "seed": profile["seed"],
    }, indent=2), encoding="utf-8")

if __name__ == "__main__":
    main()
