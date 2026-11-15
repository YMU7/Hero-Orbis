"use client";

import * as THREE from "three";
import type { AudioMix } from "./style";

// Room audio for /puzzle: one WebAudio graph with separate channels.
//
//   master ─┬─ background   ambience / music loop of the room
//           ├─ objects      sounds that come FROM an object (gramophone record),
//           │               3D-positioned at the object
//           ├─ sfx          interaction feedback (crayon, buttons, needle, chimes)
//           └─ voice        the Orbis princess audio (the <audio> element; its
//                           volume is set from here, it is not routed through
//                           WebAudio)
//
// Every sound has a built-in synthesized version (no downloads). To use a real
// recording, drop a file named after the sound id into data/puzzle-audio/
// (e.g. data/puzzle-audio/background.mp3); it is picked up on the next page
// load via /puzzle/api/audio. Listed in SOUND_IDS.
//
// The context is created on the first user gesture (browsers require one).

export const SOUND_IDS = [
  "background", // loop
  "gramophone", // loop, positional
  "crayon-pick",
  "crayon-drop",
  "crayon-draw", // loop while the crayon touches the canvas
  "button",
  "needle-down",
  "needle-up",
  "tonearm-grab",
  "sword-right",
  "sword-wrong",
  "puzzle-solved", // default "solved" sound of a puzzle component
  "portal", // something passes through the painting surface
  "portal-reject", // the painting bounces an object back
  "shutter", // camera photo
  "fire-catch",
  "rope-snap",
  "fanfare", // rescue complete
] as const;
export type SoundId = (typeof SOUND_IDS)[number];
type Channel = "background" | "objects" | "sfx";

const CHANNEL_OF: Record<SoundId, Channel> = {
  background: "background",
  gramophone: "objects",
  "crayon-pick": "sfx",
  "crayon-drop": "sfx",
  "crayon-draw": "sfx",
  button: "sfx",
  "needle-down": "sfx",
  "needle-up": "sfx",
  "tonearm-grab": "sfx",
  "sword-right": "sfx",
  "sword-wrong": "sfx",
  "puzzle-solved": "sfx",
  portal: "sfx",
  "portal-reject": "sfx",
  shutter: "sfx",
  "fire-catch": "sfx",
  "rope-snap": "sfx",
  fanfare: "sfx",
};

type Loop = { stop: () => void };

class RoomAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ch: Partial<Record<Channel, GainNode>> = {};
  private files: Partial<Record<SoundId, string>> = {};
  private buffers: Partial<Record<SoundId, AudioBuffer>> = {};
  private loops: Partial<Record<SoundId, Loop>> = {};
  private gramPanner: PannerNode | null = null;
  private gramPos = new THREE.Vector3(0, 0.9, -1);
  private mix: AudioMix | null = null;
  private voiceEl: HTMLMediaElement | null = null;
  private wanted = { background: false, gramophone: false, draw: false };
  private noise: AudioBuffer | null = null;
  readonly log: string[] = [];

  // ── Princess voice clips (public/audio/princess/<id>.wav) ────────────
  // Decoded once into AudioBuffers and played through WebAudio. Creating an
  // <audio> element + fetching + starting the media pipeline at a story beat
  // (sword, fireball…) stalled the Quest right at the big moments.
  private voiceBufs = new Map<string, Promise<AudioBuffer | null>>();
  private voiceOut: GainNode | null = null;

  private voiceBuffer(id: string) {
    let p = this.voiceBufs.get(id);
    if (!p) {
      const c = this.ctx!;
      p = fetch(`/audio/princess/${id}.wav`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((ab) => c.decodeAudioData(ab))
        .catch((e) => {
          this.log.push(`voice ${id} failed: ${(e as Error).message}`);
          return null;
        });
      this.voiceBufs.set(id, p);
    }
    return p;
  }

  /** Fetch + decode these clips in the background (after unlock). */
  preloadVoices(ids: readonly string[]) {
    if (!this.ctx) return;
    for (const id of ids) void this.voiceBuffer(id);
  }

  /** Play a voice clip; null when WebAudio isn't running (caller falls back). */
  playVoice(id: string, besidePlayer = false): { ended: Promise<void>; stop: () => void } | null {
    const c = this.ctx;
    if (!c || c.state !== "running" || !this.voiceOut) return null;
    let src: AudioBufferSourceNode | null = null;
    let pan: StereoPannerNode | null = null;
    let stopped = false;
    let resolveEnd!: () => void;
    const ended = new Promise<void>((r) => (resolveEnd = r));
    void this.voiceBuffer(id).then((buf) => {
      if (stopped) return;
      if (!buf) return resolveEnd();
      src = c.createBufferSource();
      src.buffer = buf;
      if(besidePlayer){pan=c.createStereoPanner();pan.pan.value=.8;src.connect(pan);pan.connect(this.voiceOut!);}
      else src.connect(this.voiceOut!);
      src.onended = () => {src?.disconnect();pan?.disconnect();resolveEnd();};
      src.start();
    });
    return {
      ended,
      stop: () => {
        stopped = true;
        try {
          src?.stop();
        } catch {
          /* not started */
        }
        resolveEnd();
      },
    };
  }

  /** Call from a user gesture (pointerdown / keydown / XR select). */
  unlock() {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return;
      }
      const c = this.ctx;
      this.master = c.createGain();
      this.master.connect(c.destination);
      for (const k of ["background", "objects", "sfx"] as const) {
        const g = c.createGain();
        g.connect(this.master);
        this.ch[k] = g;
      }
      // Same loudness as the old <audio> clips (volume 1, not on the mix).
      this.voiceOut = c.createGain();
      this.voiceOut.connect(c.destination);
      this.gramPanner = new PannerNode(c, { panningModel: "HRTF", distanceModel: "inverse", refDistance: 0.8, rolloffFactor: 1.2 });
      this.gramPanner.connect(this.ch.objects!);
      this.setPannerPos();
      if (this.mix) this.setMix(this.mix);
      void this.loadFiles();
    }
    void this.ctx.resume();
    this.sync();
  }

  get ready() {
    return !!this.ctx && this.ctx.state === "running";
  }

  setMix(m: AudioMix) {
    this.mix = m;
    if (this.voiceEl) this.voiceEl.volume = clamp01(m.master * m.voice);
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master!.gain.setTargetAtTime(m.master, t, 0.05);
    this.ch.background!.gain.setTargetAtTime(m.background, t, 0.05);
    this.ch.objects!.gain.setTargetAtTime(m.objects, t, 0.05);
    this.ch.sfx!.gain.setTargetAtTime(m.sfx, t, 0.05);
  }

  /** The Orbis voice element; its volume follows master × voice. */
  bindVoice(el: HTMLMediaElement | null) {
    this.voiceEl = el;
    if (el && this.mix) el.volume = clamp01(this.mix.master * this.mix.voice);
  }

  // ── State-driven loops ───────────────────────────────────────────────
  setBackground(on: boolean) {
    this.wanted.background = on;
    this.sync();
  }
  setGramophone(on: boolean) {
    this.wanted.gramophone = on;
    this.sync();
  }
  setDrawing(on: boolean) {
    this.wanted.draw = on;
    this.sync();
  }

  private sync() {
    if (!this.ctx) return;
    this.loop("background", this.wanted.background);
    this.loop("gramophone", this.wanted.gramophone);
    this.loop("crayon-draw", this.wanted.draw);
  }

  private loop(id: SoundId, on: boolean) {
    const cur = this.loops[id];
    if (on && !cur) this.loops[id] = this.startLoop(id);
    else if (!on && cur) {
      cur.stop();
      delete this.loops[id];
    }
  }

  /** Per frame: listener follows the head; gramophone source follows the object. */
  tick(camera: THREE.Camera, gramophone: THREE.Object3D | null) {
    if (!this.ctx) return;
    const L = this.ctx.listener;
    const e = camera.matrixWorld.elements;
    const p = vP.setFromMatrixPosition(camera.matrixWorld);
    const f = vF.set(-e[8], -e[9], -e[10]).normalize();
    const u = vU.set(e[4], e[5], e[6]).normalize();
    if (L.positionX) {
      L.positionX.value = p.x;
      L.positionY.value = p.y;
      L.positionZ.value = p.z;
      L.forwardX.value = f.x;
      L.forwardY.value = f.y;
      L.forwardZ.value = f.z;
      L.upX.value = u.x;
      L.upY.value = u.y;
      L.upZ.value = u.z;
    } else {
      (L as unknown as { setPosition: (x: number, y: number, z: number) => void }).setPosition(p.x, p.y, p.z);
    }
    if (gramophone) {
      gramophone.getWorldPosition(this.gramPos);
      this.gramPos.y += 0.25;
      this.setPannerPos();
    }
  }

  private setPannerPos() {
    const pn = this.gramPanner;
    if (!pn) return;
    pn.positionX.value = this.gramPos.x;
    pn.positionY.value = this.gramPos.y;
    pn.positionZ.value = this.gramPos.z;
  }

  // ── One-shots ────────────────────────────────────────────────────────
  play(id: SoundId) {
    const c = this.ctx;
    if (!c || c.state !== "running") return;
    const out = this.dest(id);
    const buf = this.buffers[id];
    if (buf) {
      const s = c.createBufferSource();
      s.buffer = buf;
      s.connect(out);
      s.start();
      return;
    }
    synthOneShot(c, id, out, this.noiseBuf());
  }

  private dest(id: SoundId): AudioNode {
    if (id === "gramophone") return this.gramPanner!;
    return this.ch[CHANNEL_OF[id]]!;
  }

  private startLoop(id: SoundId): Loop {
    const c = this.ctx!;
    const fade = c.createGain();
    fade.gain.value = 0;
    fade.connect(this.dest(id));
    fade.gain.setTargetAtTime(1, c.currentTime, id === "crayon-draw" ? 0.02 : 0.4);
    let inner: Loop;
    const buf = this.buffers[id];
    if (buf) {
      const s = c.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.connect(fade);
      s.start();
      inner = { stop: () => s.stop() };
    } else {
      inner = synthLoop(c, id, fade, this.noiseBuf());
    }
    return {
      stop: () => {
        const rel = id === "crayon-draw" ? 0.03 : 0.3;
        fade.gain.setTargetAtTime(0, c.currentTime, rel);
        setTimeout(() => {
          inner.stop();
          fade.disconnect();
        }, rel * 6000);
      },
    };
  }

  private noiseBuf() {
    const c = this.ctx!;
    if (!this.noise) {
      this.noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return this.noise;
  }

  // ── Optional recorded files (data/puzzle-audio/<id>.<ext>) ───────────
  private async loadFiles() {
    try {
      const r = await fetch("/puzzle/api/audio", { cache: "no-store" });
      const b = (await r.json()) as { files?: Array<{ id: string; url: string }> };
      for (const f of b.files ?? []) {
        if (!(SOUND_IDS as readonly string[]).includes(f.id)) continue;
        this.files[f.id as SoundId] = f.url;
      }
      await Promise.all(
        Object.entries(this.files).map(async ([id, url]) => {
          try {
            const ab = await (await fetch(url!)).arrayBuffer();
            this.buffers[id as SoundId] = await this.ctx!.decodeAudioData(ab);
            this.log.push(`file ${id}`);
            // A running synth loop switches to the recording.
            const k = id as SoundId;
            if (this.loops[k]) {
              this.loops[k]!.stop();
              delete this.loops[k];
              this.sync();
            }
          } catch (e) {
            this.log.push(`file ${id} failed: ${(e as Error).message}`);
          }
        }),
      );
    } catch (e) {
      this.log.push(`audio list failed: ${(e as Error).message}`);
    }
  }

  /** Test / HUD hook. */
  debug() {
    return {
      state: this.ctx?.state ?? "none",
      loops: Object.keys(this.loops),
      files: Object.keys(this.buffers),
      mix: this.mix,
    };
  }
}

const vP = new THREE.Vector3();
const vF = new THREE.Vector3();
const vU = new THREE.Vector3();
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

// ── Built-in synthesized sounds (soft, music-box / storybook flavour) ──────

function tone(c: AudioContext, out: AudioNode, freq: number, at: number, dur: number, peak: number, type: OscillatorType = "sine") {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(out);
  o.start(at);
  o.stop(at + dur + 0.05);
}

function noiseBurst(c: AudioContext, out: AudioNode, noise: AudioBuffer, at: number, dur: number, peak: number, freq: number, q = 1) {
  const s = c.createBufferSource();
  s.buffer = noise;
  const f = c.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  s.connect(f).connect(g).connect(out);
  s.start(at, Math.random());
  s.stop(at + dur + 0.05);
}

function synthOneShot(c: AudioContext, id: SoundId, out: AudioNode, noise: AudioBuffer) {
  const t = c.currentTime;
  switch (id) {
    case "crayon-pick":
      tone(c, out, 880, t, 0.12, 0.25);
      tone(c, out, 1320, t + 0.05, 0.15, 0.18);
      break;
    case "crayon-drop":
      noiseBurst(c, out, noise, t, 0.08, 0.5, 900, 2);
      tone(c, out, 330, t, 0.1, 0.2, "triangle");
      break;
    case "button":
      noiseBurst(c, out, noise, t, 0.03, 0.6, 3000, 3);
      tone(c, out, 620, t, 0.08, 0.25, "triangle");
      break;
    case "tonearm-grab":
      noiseBurst(c, out, noise, t, 0.04, 0.4, 2200, 4);
      break;
    case "needle-down":
      noiseBurst(c, out, noise, t, 0.12, 0.7, 500, 1);
      noiseBurst(c, out, noise, t + 0.02, 0.25, 0.25, 4000, 0.7);
      break;
    case "needle-up":
      noiseBurst(c, out, noise, t, 0.06, 0.4, 1800, 2);
      tone(c, out, 500, t, 0.15, 0.08);
      break;
    case "sword-right":
      [784, 988, 1175, 1568].forEach((f, i) => tone(c, out, f, t + i * 0.09, 0.9, 0.22));
      break;
    case "puzzle-solved":
      // Soft magical shimmer: rising arpeggio + airy sparkle.
      [523.3, 659.3, 784, 1046.5, 1318.5].forEach((f, i) => tone(c, out, f, t + i * 0.07, 1.2, 0.16));
      for (let i = 0; i < 8; i++) noiseBurst(c, out, noise, t + 0.1 + i * 0.06, 0.05, 0.05, 6000 + i * 400, 4);
      break;
    case "portal":
      // Watery shimmer sweeping upward through the canvas.
      [392, 523.3, 784, 1046.5, 1568].forEach((f, i) => tone(c, out, f, t + i * 0.05, 0.9, 0.12));
      noiseBurst(c, out, noise, t, 0.5, 0.18, 1800, 0.6);
      break;
    case "portal-reject":
      tone(c, out, 220, t, 0.3, 0.3, "triangle");
      tone(c, out, 165, t + 0.08, 0.35, 0.25, "triangle");
      noiseBurst(c, out, noise, t, 0.12, 0.3, 700, 1.5);
      break;
    case "shutter":
      noiseBurst(c, out, noise, t, 0.04, 0.7, 4200, 2);
      noiseBurst(c, out, noise, t + 0.07, 0.05, 0.5, 2600, 2);
      tone(c, out, 2400, t + 0.02, 0.25, 0.08);
      break;
    case "fire-catch":
      noiseBurst(c, out, noise, t, 0.35, 0.45, 600, 0.7);
      tone(c, out, 660, t, 0.3, 0.12, "triangle");
      break;
    case "rope-snap":
      noiseBurst(c, out, noise, t, 0.05, 0.8, 1500, 3);
      noiseBurst(c, out, noise, t + 0.03, 0.6, 0.3, 500, 0.6);
      break;
    case "fanfare":
      [523.3, 659.3, 784].forEach((f, i) => tone(c, out, f, t + i * 0.13, 0.25, 0.2, "triangle"));
      [1046.5, 1318.5, 1568].forEach((f) => tone(c, out, f, t + 0.42, 1.4, 0.13, "triangle"));
      for (let i = 0; i < 10; i++) noiseBurst(c, out, noise, t + 0.45 + i * 0.07, 0.05, 0.05, 6500 + i * 300, 4);
      break;
    case "sword-wrong":
      tone(c, out, 392, t, 0.25, 0.22, "triangle");
      tone(c, out, 330, t + 0.16, 0.35, 0.2, "triangle");
      break;
    default:
      break;
  }
}

function synthLoop(c: AudioContext, id: SoundId, out: AudioNode, noise: AudioBuffer): Loop {
  if (id === "crayon-draw") {
    // Waxy scratch: filtered noise with a slow wobble.
    const s = c.createBufferSource();
    s.buffer = noise;
    s.loop = true;
    const f = c.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 2600;
    f.Q.value = 0.8;
    const g = c.createGain();
    g.gain.value = 0.18;
    const lfo = c.createOscillator();
    const lg = c.createGain();
    lfo.frequency.value = 7;
    lg.gain.value = 0.08;
    lfo.connect(lg).connect(g.gain);
    s.connect(f).connect(g).connect(out);
    s.start();
    lfo.start();
    return { stop: () => (s.stop(), lfo.stop()) };
  }
  if (id === "gramophone") {
    // Music-box melody + vinyl crackle.
    const notes = [659.3, 784, 987.8, 784, 880, 1046.5, 880, 784, 659.3, 740, 784, 587.3];
    let i = 0;
    const tick = () => tone(c, out, notes[i++ % notes.length], c.currentTime, 0.7, 0.18);
    tick();
    const timer = setInterval(tick, 380);
    const crackle = setInterval(() => {
      if (Math.random() < 0.6) noiseBurst(c, out, noise, c.currentTime + Math.random() * 0.1, 0.01, 0.12 + Math.random() * 0.15, 3500, 1);
    }, 90);
    const hiss = c.createBufferSource();
    hiss.buffer = noise;
    hiss.loop = true;
    const hf = c.createBiquadFilter();
    hf.type = "highpass";
    hf.frequency.value = 5000;
    const hg = c.createGain();
    hg.gain.value = 0.012;
    hiss.connect(hf).connect(hg).connect(out);
    hiss.start();
    return { stop: () => (clearInterval(timer), clearInterval(crackle), hiss.stop()) };
  }
  // background: warm slow pad (two detuned triangle chords) + soft breeze.
  const chords = [
    [261.6, 329.6, 392],
    [220, 261.6, 329.6],
    [174.6, 220, 261.6],
    [196, 246.9, 293.7],
  ];
  const pad = c.createGain();
  pad.gain.value = 0.05;
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 1200;
  pad.connect(lp).connect(out);
  let k = 0;
  const playChord = () => {
    const t = c.currentTime;
    for (const f of chords[k++ % chords.length]) {
      for (const det of [-4, 4]) {
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = "triangle";
        o.frequency.value = f;
        o.detune.value = det;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.5, t + 1.5);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 6.5);
        o.connect(g).connect(pad);
        o.start(t);
        o.stop(t + 6.6);
      }
    }
  };
  playChord();
  const timer = setInterval(playChord, 5000);
  const wind = c.createBufferSource();
  wind.buffer = noise;
  wind.loop = true;
  const wf = c.createBiquadFilter();
  wf.type = "lowpass";
  wf.frequency.value = 500;
  const wg = c.createGain();
  wg.gain.value = 0.025;
  const lfo = c.createOscillator();
  const lg = c.createGain();
  lfo.frequency.value = 0.08;
  lg.gain.value = 0.015;
  lfo.connect(lg).connect(wg.gain);
  wind.connect(wf).connect(wg).connect(out);
  wind.start();
  lfo.start();
  return { stop: () => (clearInterval(timer), wind.stop(), lfo.stop()) };
}

export const roomAudio = new RoomAudio();
// Test hook (read-only inspection from the browser console / automation).
if (typeof window !== "undefined") (window as unknown as { __roomAudio?: RoomAudio }).__roomAudio = roomAudio;
