#!/usr/bin/env python3
"""Reproducible placeholder foley. Original procedural audio, CC0."""
import math, pathlib, random, struct, wave
random.seed(14)
out=pathlib.Path(__file__).resolve().parents[1]/'Assets/Resources/Audio'
out.mkdir(parents=True,exist_ok=True)
rate=24000
specs={'latch':.32,'click':.12,'ceramic':.65,'cut':.25,'magic':1.0,'squeak':.48,'reject':.35}
for name,duration in specs.items():
    samples=[]
    for i in range(int(rate*duration)):
        t=i/rate;p=t/duration;noise=random.uniform(-1,1)
        if name=='magic':
            v=sum(math.sin(2*math.pi*f*t)*.12 for f in [523.25,659.25,783.99])*math.sin(math.pi*p)**2
        elif name=='ceramic':
            v=(noise*.45+math.sin(2*math.pi*1733*t)*.14)*math.exp(-p*7)
        elif name=='cut':v=noise*.35*math.sin(math.pi*p)**2
        elif name=='squeak':v=math.sin(2*math.pi*(700*t+400*t*t))*.16*math.sin(math.pi*p)
        elif name=='reject':v=math.sin(2*math.pi*(160*t-100*t*t))*.25*math.sin(math.pi*p)
        elif name=='latch':v=(noise*.40 if t<.03 or .12<t<.15 else math.sin(2*math.pi*100*t)*.04)*math.exp(-p*4)
        else:v=noise*.3*math.exp(-p*12)
        samples.append(struct.pack('<h',int(max(-1,min(1,v))*30000)))
    with wave.open(str(out/(name+'.wav')),'wb') as f:
        f.setnchannels(1);f.setsampwidth(2);f.setframerate(rate);f.writeframes(b''.join(samples))
