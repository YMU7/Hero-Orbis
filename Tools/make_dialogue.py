#!/usr/bin/env python3
"""Source of truth for dialogue. Generates Unity JSON and optional neural TTS WAVs.
Run: uv run --with edge-tts python Tools/make_dialogue.py --audio
Offline: python Tools/make_dialogue.py --audio --espeak /path/to/espeak-ng
"""
import argparse, asyncio, json, pathlib, subprocess, tempfile
ROOT = pathlib.Path(__file__).resolve().parents[1]
LINES = {
'voice': 'Oh, thank goodness. I was beginning to think I was a still life.',
'bell_thanks': 'And thank you for ringing. It was very quietly reassuring.',
'hammer_thanks': 'Excellent. We have established that some problems can be solved with a hammer.',
'intro': 'I am Iris. There was a wizard. I criticized his portrait. We have both handled it badly.',
'draw_request': 'Right. First, that ribbon. Draw your sword.',
'real_sword': 'Yes. That was what I meant. I am as disappointed as you are.',
'real_repeat': 'We have established that you own a sword. The ribbon remains unconvinced.',
'drawing': 'A sketch? Now? I appreciate the commission, but...',
'extract': 'Oh. You drew your sword.',
'cut': 'I hate that this is grammatically defensible.',
'knight_intro': 'Of course. A knight. You will have to defeat him.',
'combat': 'He appears to have trained extensively against the obvious.',
'still_real': 'Still a very real sword.',
'letters_wrong': 'We have confused him. An improvement.',
'letters_empty': 'Anonymous, but still employed.',
'night': 'You did not defeat the knight. You deleted his first letter.',
'rule': 'Wait. The words are not describing the curse. They are controlling it. Right. No more sensible instructions.',
'bridge_request': 'We need a drawbridge. No. We need something drawn that can be a bridge.',
'early_crank': 'Perfect. If I were a biscuit.',
'new_bridge': 'Possibly. Though you have already drawn something long enough.',
'sword_bridge': 'A sword laid flat. Yes. A bridge with an unnecessarily aggressive handle.',
'lower': 'Lower the drawn bridge.',
'crossed': 'I am getting good at this. That worries me.',
'door_request': 'I am at the edge. But it is still a painting. Then stop making it a painting. Draw me a way out.',
'wrong_door': 'Lovely door. Wrong prison.',
'inside_door': 'That would get me out of the castle. I need to get out of the picture.',
'frame': 'Yes. Around the whole thing.',
'handle': 'A painting of a princess, or a door with a princess behind it.',
'open': 'I much prefer your interpretation.',
'brave': 'Thank you. You have been very brave.',
'equipped': 'And remarkably well equipped for a different game.',
'keep': 'Keep that. If anyone asks, it is a sword.',
'art': 'Only art may alter art. We need the charcoal version.',
'premature': 'One absurdity at a time. We still have something in the way.',
'hint_1_0': 'Apparently the ribbon requires an artistic response.',
'hint_1_1': 'There is charcoal beside that drawing board.',
'hint_1_2': 'Try drawing a sword. I cannot believe I am recommending this.',
'hint_2_0': 'We changed silence by changing the sign. Perhaps his job title is negotiable.',
'hint_2_1': 'His name is one letter away from something else.',
'hint_2_2': 'Take the K out of knight.',
'hint_3_0': 'Something we have already drawn. Long, flat, and currently being used rather narrowly.',
'hint_3_1': 'Try laying the charcoal sword across those supports.',
'hint_3_2': 'Now lower it with the crank.',
'hint_4_0': 'A door drawn inside a painting is still inside a painting.',
'hint_4_1': 'Look at the frame. Hinges on one side. Something missing on the other.',
'hint_4_2': 'Trace the outside of the frame. Draw a handle. Open the painting.',
'hint_5_0': 'There is a handle now. Give it a pull.',
}

def manifest():
    p = ROOT / 'Assets/Resources/Dialogue.json'
    p.write_text(json.dumps({'lines': [{'id': k, 'text': v} for k,v in LINES.items()]}, indent=2)+'\n')

async def audio(args):
    out = ROOT / 'Assets/Resources/Voice'; out.mkdir(parents=True,exist_ok=True)
    sem = asyncio.Semaphore(3)
    async def one(key, text):
        dest = out / (key+'.wav')
        if dest.exists() and not args.force: return
        async with sem:
            if args.espeak:
                subprocess.run([args.espeak, '-v', 'en-gb+f3', '-s', '155', '-w', str(dest), text], check=True)
            else:
                import edge_tts
                for attempt in range(3):
                    try:
                        with tempfile.TemporaryDirectory() as tmp:
                            mp3 = pathlib.Path(tmp)/'line.mp3'
                            await edge_tts.Communicate(text, args.voice, rate='-5%').save(str(mp3))
                            subprocess.run(['ffmpeg','-v','error','-y','-i',str(mp3),'-ar','24000','-ac','1',str(dest)],check=True)
                        break
                    except Exception:
                        if attempt==2: raise
                        await asyncio.sleep(2)
            print(key, flush=True)
    await asyncio.gather(*(one(k,t) for k,t in LINES.items()))

if __name__ == '__main__':
    ap=argparse.ArgumentParser(); ap.add_argument('--audio',action='store_true'); ap.add_argument('--espeak'); ap.add_argument('--force',action='store_true'); ap.add_argument('--voice', default='en-GB-SoniaNeural'); args=ap.parse_args()
    manifest()
    if args.audio: asyncio.run(audio(args))
