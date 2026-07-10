/**
 * Tiny WebAudio synth for game feedback. Deliberately restrained:
 * short, quiet cues only — no music loop. All calls are no-ops when muted
 * or before the first user gesture (browsers gate AudioContext on input).
 */

let ctx: AudioContext | null = null;
let muted = false;

export function setMuted(m: boolean) {
  muted = m;
}
export function isMuted() {
  return muted;
}

/** Call from a user-gesture handler (keydown/click) to unlock audio. */
export function ensureAudio() {
  if (typeof window === "undefined") return;
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      ctx = null;
    }
  }
  if (ctx && ctx.state === "suspended") void ctx.resume();
}

type ToneOpts = {
  freq: number;
  ms: number;
  type?: OscillatorType;
  vol?: number;
  glideTo?: number;
  delayMs?: number;
};

function tone({ freq, ms, type = "sine", vol = 0.08, glideTo, delayMs = 0 }: ToneOpts) {
  if (muted || !ctx || ctx.state !== "running") return;
  const t0 = ctx.currentTime + delayMs / 1000;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + ms / 1000);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0004, t0 + ms / 1000);
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + ms / 1000 + 0.02);
}

/** Correct answer: short pop, pitch rises with streak (caps out). */
export function sfxHit(streak: number) {
  const base = 380 + Math.min(streak, 12) * 45;
  tone({ freq: base, ms: 90, type: "triangle", vol: 0.09 });
  tone({ freq: base * 1.5, ms: 70, type: "sine", vol: 0.05, delayMs: 25 });
}

/** Crit: the hit plus a bright zing. */
export function sfxCrit() {
  tone({ freq: 880, ms: 140, type: "sawtooth", vol: 0.05, glideTo: 1760 });
}

/** Wrong: soft low buzz — noticeable, not punishing. */
export function sfxWrong() {
  tone({ freq: 160, ms: 180, type: "square", vol: 0.05, glideTo: 110 });
}

/** Final-seconds tick. */
export function sfxTick() {
  tone({ freq: 1000, ms: 40, type: "sine", vol: 0.045 });
}

export function sfxVictory() {
  [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, ms: 180, type: "triangle", vol: 0.08, delayMs: i * 110 }));
}

export function sfxDefeat() {
  [392, 330, 262].forEach((f, i) => tone({ freq: f, ms: 220, type: "triangle", vol: 0.07, delayMs: i * 140 }));
}

/** Boss entrance thud. */
export function sfxEnter() {
  tone({ freq: 120, ms: 220, type: "sine", vol: 0.09, glideTo: 60 });
}
