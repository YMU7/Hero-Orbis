from pathlib import Path
import argparse, json, os, time
parser=argparse.ArgumentParser()
parser.add_argument('--ids', nargs='*', help='Generate only these dialogue IDs')
parser.add_argument('--force', action='store_true', help='Replace selected existing clips')
args=parser.parse_args()
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
# Story beats first, then hints and quips (same voice, same seed).
lines=[]
for name in ('rescueDialogue.json','rescueBarks.json'):
 lines+=json.loads((ROOT/'app/puzzle/lib'/name).read_text(encoding='utf-8'))
for beat in lines:
 if not beat['text']: continue
 if args.ids is not None and beat['id'] not in args.ids: continue
 output=ROOT/'public/audio/princess'/f"{beat['id']}.wav"
 if output.exists() and not args.force: continue
 torch.manual_seed(profile['seed'])
 print('Generating '+beat['id'],flush=True)
 with torch.inference_mode():
  wavs,sr=model.generate_voice_design(text=beat['text'],language='English',instruct=profile['description'],max_new_tokens=4096)
 sf.write(output,wavs[0],sr,subtype='PCM_16')
 print(f'Saved {output.name}: {sf.info(output).duration:.1f}s',flush=True)
 metadata=output.with_suffix('.json')
 metadata.write_text(json.dumps({'text':beat['text'],'seed':profile['seed'],'description':profile['description'],'duration':sf.info(output).duration},indent=2),encoding='utf-8')
