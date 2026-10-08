import type { Vector3 } from "three";

/**
 * A tiny synthesized soundscape. Nothing is loaded: every sound is built from
 * oscillators and filtered noise, so it stays light and always matches the world.
 */

type Spatial = { pan: number; gain: number };
type LoopName = "ocean" | "wind" | "rain" | "pour" | "night" | "fire";

const PENTA = [0, 2, 4, 7, 9, 12, 14, 16];
const KEY = "tiny-island-muted";

class Engine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  sfxBus!: GainNode;
  ambBus!: GainNode;
  white!: AudioBuffer;
  brown!: AudioBuffer;
  loops = new Map<LoopName, { gain: GainNode; filter: BiquadFilterNode; src: AudioBufferSourceNode }>();
  muted = false;
  listeners = new Set<() => void>();
  spatial: (p: Vector3) => Spatial = () => ({ pan: 0, gain: 1 });
  private lastPlay = new Map<string, number>();
  private cricketT = 0;

  constructor() {
    if (typeof window !== "undefined") {
      try {
        this.muted = localStorage.getItem(KEY) === "1";
      } catch {
        // ignore
      }
    }
  }

  /** must be called from a user gesture */
  start() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.8;
    this.sfxBus.connect(this.master);
    this.ambBus = ctx.createGain();
    this.ambBus.gain.value = 0;
    this.ambBus.connect(this.master);
    this.ambBus.gain.linearRampToValueAtTime(1, ctx.currentTime + 3);

    const len = ctx.sampleRate * 3;
    this.white = ctx.createBuffer(1, len, ctx.sampleRate);
    this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const w = this.white.getChannelData(0);
    const b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const r = Math.random() * 2 - 1;
      w[i] = r;
      last = (last + 0.02 * r) / 1.02;
      b[i] = last * 3.5;
    }
    this.makeLoop("ocean", this.brown, "lowpass", 520, 0.6);
    this.makeLoop("wind", this.white, "bandpass", 500, 0.9);
    this.makeLoop("rain", this.white, "highpass", 1400, 0.4);
    this.makeLoop("pour", this.white, "bandpass", 2600, 1.2);
    this.makeLoop("fire", this.brown, "bandpass", 900, 2);
  }

  private makeLoop(name: LoopName, buf: AudioBuffer, type: BiquadFilterType, freq: number, q: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = Math.random();
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(name === "pour" ? this.sfxBus : this.ambBus);
    src.start();
    this.loops.set(name, { gain, filter, src });
  }

  setMuted(m: boolean) {
    this.muted = m;
    try {
      localStorage.setItem(KEY, m ? "1" : "0");
    } catch {
      // ignore
    }
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.2);
    this.listeners.forEach((l) => l());
  }

  subscribe(l: () => void) {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }

  loop(name: LoopName, level: number, freq?: number) {
    const l = this.loops.get(name);
    if (!l || !this.ctx) return;
    const t = this.ctx.currentTime;
    l.gain.gain.setTargetAtTime(level, t, 0.25);
    if (freq !== undefined) l.filter.frequency.setTargetAtTime(freq, t, 0.3);
  }

  /** per-frame ambience */
  ambience(o: { ocean: number; wind: number; rain: number; night: number; storm: number; dt: number; birds: number; fire: number }) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const swell = 0.75 + 0.25 * Math.sin(t * 0.45) * Math.sin(t * 0.17 + 1);
    this.loop("ocean", (0.16 + o.storm * 0.22) * swell * o.ocean, 380 + swell * 260 + o.storm * 300);
    this.loop("wind", Math.min(0.32, 0.02 + o.wind * o.wind * 0.14), 320 + o.wind * 600);
    this.loop("rain", o.rain * 0.16, 1400 + o.storm * 600);
    this.loop("fire", o.fire * 0.05 * (0.6 + 0.4 * Math.random()));
    // crickets at night, little birds by day
    this.cricketT -= o.dt;
    if (this.cricketT < 0) {
      if (o.night > 0.6 && o.rain < 0.3) {
        this.cricketT = 0.5 + Math.random() * 1.6;
        this.cricket(o.night);
      } else if (o.birds > 0 && o.rain < 0.3 && Math.random() < 0.5) {
        this.cricketT = 2 + Math.random() * 5;
        this.play("chirp", 0.25 * o.birds, 0.9 + Math.random() * 0.4, (Math.random() - 0.5) * 1.2);
      } else this.cricketT = 1.5;
    }
  }

  private cricket(level: number) {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    pan.connect(this.ambBus);
    const f = 4200 + Math.random() * 600;
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const g = ctx.createGain();
      const s = t + i * 0.07;
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.018 * level, s + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.05);
      o.connect(g).connect(pan);
      o.start(s);
      o.stop(s + 0.06);
    }
  }

  /* ---------------- one-shots ---------------- */
  private out(pan: number, gain: number) {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = gain;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p).connect(this.sfxBus);
    return g;
  }

  private tone(dest: AudioNode, o: { f: number; f2?: number; type?: OscillatorType; dur: number; gain: number; at?: number; attack?: number; delay?: number }) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type ?? "sine";
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + (o.at ?? o.dur));
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.gain, t + (o.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    osc.connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + o.dur + 0.05);
    return osc;
  }

  private noise(dest: AudioNode, o: { type: BiquadFilterType; f: number; f2?: number; q?: number; dur: number; gain: number; attack?: number; brown?: boolean; delay?: number }) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = o.brown ? this.brown : this.white;
    const filter = ctx.createBiquadFilter();
    filter.type = o.type;
    filter.frequency.setValueAtTime(o.f, t);
    if (o.f2) filter.frequency.exponentialRampToValueAtTime(o.f2, t + o.dur);
    filter.Q.value = o.q ?? 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.gain, t + (o.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(filter).connect(g).connect(dest);
    src.start(t, Math.random() * 2);
    src.stop(t + o.dur + 0.05);
  }

  private bell(dest: AudioNode, f: number, gain: number, dur: number, partials: number[], delay = 0) {
    partials.forEach((p, i) => this.tone(dest, { f: f * p, dur: dur / (1 + i * 0.5), gain: gain / (1 + i * 0.8), delay, attack: 0.002 }));
  }

  playAt(name: string, pos: Vector3 | undefined, strength = 1, pitch = 1) {
    if (!this.ctx || this.muted) return;
    const sp = pos ? this.spatial(pos) : { pan: 0, gain: 1 };
    if (sp.gain < 0.02) return;
    this.play(name, strength * sp.gain, pitch, sp.pan);
  }

  play(name: string, strength = 1, pitch = 1, pan = 0) {
    if (!this.ctx || this.muted) return;
    // avoid machine-gunning the same sound
    const now = this.ctx.currentTime;
    const last = this.lastPlay.get(name) ?? -1;
    if (now - last < 0.035) return;
    this.lastPlay.set(name, now);
    const s = Math.max(0.05, Math.min(1.2, strength));
    const p = pitch;
    const d = this.out(pan, 1);
    const r = Math.random;
    switch (name) {
      case "drip":
        this.tone(d, { f: 700 * p, f2: 1500 * p, dur: 0.12, gain: 0.18 * s, at: 0.06 });
        break;
      case "plop":
        this.tone(d, { f: 520 * p, f2: 160 * p, dur: 0.16, gain: 0.25 * s });
        this.noise(d, { type: "lowpass", f: 900, dur: 0.12, gain: 0.12 * s });
        break;
      case "splash":
        this.noise(d, { type: "bandpass", f: 1400, f2: 500, q: 0.6, dur: 0.5 + s * 0.4, gain: 0.35 * s, attack: 0.01 });
        this.tone(d, { f: 380 * p, f2: 110, dur: 0.22, gain: 0.25 * s });
        break;
      case "skip":
        this.tone(d, { f: 1100 * p, f2: 1900 * p, dur: 0.07, gain: 0.16 * s });
        this.noise(d, { type: "highpass", f: 2500, dur: 0.06, gain: 0.08 * s });
        break;
      case "pop":
        this.tone(d, { f: 520 * p, f2: 980 * p, dur: 0.08, gain: 0.2 * s });
        break;
      case "bloop":
        this.tone(d, { f: 380 * p, f2: 760 * p, dur: 0.14, gain: 0.16 * s });
        break;
      case "tick":
      case "pick":
        this.noise(d, { type: "highpass", f: 3200, dur: 0.03, gain: 0.12 * s });
        this.tone(d, { f: 1700 * p, dur: 0.04, gain: 0.07 * s });
        break;
      case "knock":
        this.tone(d, { f: 190 * p, f2: 90 * p, dur: 0.12, gain: 0.35 * s });
        this.noise(d, { type: "lowpass", f: 600, dur: 0.07, gain: 0.2 * s });
        break;
      case "clack":
        this.noise(d, { type: "bandpass", f: 2400 * p, q: 3, dur: 0.06, gain: 0.3 * s });
        this.tone(d, { f: 900 * p, f2: 600 * p, dur: 0.05, gain: 0.08 * s });
        break;
      case "thud":
        this.tone(d, { f: 120 * p, f2: 70, dur: 0.14, gain: 0.3 * s });
        this.noise(d, { type: "lowpass", f: 400, dur: 0.1, gain: 0.12 * s });
        break;
      case "sand":
        this.noise(d, { type: "lowpass", f: 2600, dur: 0.14, gain: 0.12 * s });
        break;
      case "door":
      case "creak":
      case "rope":
        this.tone(d, { f: (name === "rope" ? 260 : 170) * p, f2: (name === "rope" ? 220 : 250) * p, type: "sawtooth", dur: 0.45, gain: 0.035 * s, attack: 0.08 });
        break;
      case "chime":
        this.bell(d, 1046 * p, 0.09 * s, 1.6, [1, 2.76, 5.4]);
        break;
      case "secret": {
        [0, 4, 7, 12].forEach((n, i) => this.bell(d, 784 * Math.pow(2, n / 12), 0.08, 1.8, [1, 2.76], i * 0.11));
        break;
      }
      case "note":
        this.bell(d, 523 * p, 0.11 * s, 2.2, [1, 2, 3.01]);
        break;
      case "bell":
        this.bell(d, 540 * p, 0.14 * s, 2.8, [1, 2.0, 2.42, 3.0, 4.13]);
        break;
      case "horn": {
        this.tone(d, { f: 98, type: "sawtooth", dur: 1.6, gain: 0.05 * s, attack: 0.25 });
        this.tone(d, { f: 98.8, type: "sawtooth", dur: 1.6, gain: 0.05 * s, attack: 0.25 });
        this.tone(d, { f: 49, dur: 1.6, gain: 0.12 * s, attack: 0.3 });
        break;
      }
      case "thunder":
        this.noise(d, { type: "lowpass", f: 420, f2: 90, dur: 3.2 + s, gain: 0.7 * s, attack: 0.05, brown: true });
        this.noise(d, { type: "lowpass", f: 900, f2: 150, dur: 0.9, gain: 0.35 * s, attack: 0.01, brown: true, delay: 0.15 });
        break;
      case "zap":
        this.noise(d, { type: "highpass", f: 2200, dur: 0.18, gain: 0.3 * s });
        this.tone(d, { f: 2400, f2: 160, dur: 0.2, gain: 0.08 * s, type: "square" });
        break;
      case "puff":
        this.noise(d, { type: "lowpass", f: 900, f2: 300, dur: 0.3, gain: 0.16 * s, attack: 0.03 });
        break;
      case "whoosh":
        this.noise(d, { type: "bandpass", f: 400, f2: 1600, q: 1.2, dur: 0.35, gain: 0.22 * s, attack: 0.08 });
        break;
      case "gust":
        this.noise(d, { type: "bandpass", f: 300, f2: 1100, q: 0.8, dur: 0.9, gain: 0.2 * s, attack: 0.25 });
        break;
      case "cork":
        this.tone(d, { f: 300, f2: 1300, dur: 0.06, gain: 0.25 * s });
        this.noise(d, { type: "highpass", f: 1800, dur: 0.05, gain: 0.15 * s });
        break;
      case "rustle":
        for (let i = 0; i < 4; i++) this.noise(d, { type: "bandpass", f: 2600 + r() * 1500, q: 0.8, dur: 0.12, gain: 0.09 * s, delay: i * 0.05 + r() * 0.03 });
        break;
      case "flap":
        for (let i = 0; i < 4; i++) this.noise(d, { type: "lowpass", f: 1100, dur: 0.06, gain: 0.08 * s, delay: i * 0.085 });
        break;
      case "boing": {
        const o = this.tone(d, { f: 200 * p, f2: 520 * p, dur: 0.5, gain: 0.18 * s, at: 0.12 });
        o.frequency.exponentialRampToValueAtTime(280 * p, this.ctx.currentTime + 0.45);
        break;
      }
      case "sparkle":
        for (let i = 0; i < 4; i++)
          this.tone(d, { f: 1568 * Math.pow(2, PENTA[Math.floor(r() * 6)] / 12) * p, dur: 0.35, gain: 0.05 * s, delay: i * 0.06 });
        break;
      case "chirp": {
        const n = 2 + Math.floor(r() * 3);
        for (let i = 0; i < n; i++) this.tone(d, { f: 2900 * p, f2: 4300 * p, dur: 0.07, gain: 0.05 * s, delay: i * 0.11 });
        break;
      }
      case "gull":
        this.tone(d, { f: 1500 * p, f2: 900 * p, dur: 0.45, gain: 0.05 * s, type: "triangle", attack: 0.03 });
        this.tone(d, { f: 1400 * p, f2: 850 * p, dur: 0.4, gain: 0.04 * s, type: "triangle", delay: 0.3 });
        break;
      case "croak": {
        const o = this.tone(d, { f: 130 * p, f2: 110 * p, dur: 0.32, gain: 0.12 * s, type: "sawtooth", attack: 0.02 });
        const lfo = this.ctx.createOscillator();
        lfo.frequency.value = 28;
        const lg = this.ctx.createGain();
        lg.gain.value = 40;
        lfo.connect(lg).connect(o.frequency);
        lfo.start();
        lfo.stop(this.ctx.currentTime + 0.4);
        break;
      }
      case "snap":
        this.noise(d, { type: "highpass", f: 4000, dur: 0.025, gain: 0.2 * s });
        this.noise(d, { type: "highpass", f: 4000, dur: 0.025, gain: 0.16 * s, delay: 0.09 });
        break;
      case "hop":
        this.tone(d, { f: 160, f2: 90, dur: 0.08, gain: 0.12 * s });
        break;
      case "whale": {
        const o = this.tone(d, { f: 140, f2: 95, dur: 2.6, gain: 0.16 * s, type: "triangle", attack: 0.5, at: 1.2 });
        o.frequency.exponentialRampToValueAtTime(150, this.ctx.currentTime + 2.4);
        break;
      }
      case "grow":
        this.tone(d, { f: 300 * p, f2: 620 * p, dur: 0.6, gain: 0.07 * s, attack: 0.1 });
        break;
      case "seeds":
        for (let i = 0; i < 5; i++) this.noise(d, { type: "highpass", f: 3500, dur: 0.02, gain: 0.08 * s, delay: i * 0.03 + r() * 0.02 });
        break;
      default:
        this.tone(d, { f: 600 * p, dur: 0.06, gain: 0.05 * s });
    }
  }
}

export const audio = new Engine();
