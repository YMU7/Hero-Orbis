from pathlib import Path
import json, os, time
ROOT=Path(__file__).resolve().parents[1]
QWEN=ROOT/'archive/2026-11-14-unity-webxr-port/Tools/Speech/qwen'
import sys
sys.path.insert(0,str(QWEN/'.venv/Lib/site-packages'))
os.environ['HF_HOME']=str(QWEN/'cache')
import torch, soundfile as sf
from qwen_tts import Qwen3TTSModel
profile=json.loads((QWEN/'princess.json').read_text())
torch.set_num_threads(8)
model=Qwen3TTSModel.from_pretrained(str(QWEN/'models/VoiceDesign'),device_map='cpu',dtype=torch.float32,attn_implementation='sdpa',local_files_only=True)
for beat in json.loads((ROOT/'app/puzzle/lib/rescueDialogue.json').read_text()):
 if not beat['text']: continue
 output=ROOT/'public/audio/princess'/f"{beat['id']}.wav"
 if output.exists(): continue
 torch.manual_seed(profile['seed'])
 print('Generating '+beat['id'],flush=True)
 with torch.inference_mode():
  wavs,sr=model.generate_voice_design(text=beat['text'],language='English',instruct=profile['description'],max_new_tokens=4096)
 sf.write(output,wavs[0],sr,subtype='PCM_16')
 print(f'Saved {output.name}: {sf.info(output).duration:.1f}s',flush=True)

