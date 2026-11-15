#!/usr/bin/env python3
"""Check manifest JSON and all referenced dialogue/audio assets before editor import."""
import json,pathlib,wave
root=pathlib.Path(__file__).resolve().parents[1]
resources=root/'Assets/Resources'
lines=json.loads((resources/'Dialogue.json').read_text())['lines']
assert len({x['id'] for x in lines})==len(lines), 'Duplicate line IDs'
seconds=0
for line in lines:
    assert line['text'].strip()
    with wave.open(str(resources/'Voice'/(line['id']+'.wav'))) as audio:
        assert audio.getnchannels()==1 and audio.getnframes()>1000,line['id']
        seconds+=audio.getnframes()/audio.getframerate()
assert len(lines)==len(list((resources/'Voice').glob('*.wav'))), 'Stale or missing recordings'
for name in ['latch','click','ceramic','cut','magic','squeak','reject']:
    with wave.open(str(resources/'Audio'/(name+'.wav'))) as audio:assert audio.getnframes()>0
assert (resources/'Art/Princess.jpg').read_bytes().startswith(b'\xff\xd8'), 'Invalid portrait'
for path in [root/'Packages/manifest.json',*root.glob('Assets/**/*.asmdef')]:json.loads(path.read_text())
print(f'{len(lines)} voice clips ({seconds:.1f}s), 7 sound effects, portrait and package/assembly JSON: OK')
