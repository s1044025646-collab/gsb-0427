import { NEGATIVE_POWER_TOLERANCE } from "./constants.js";

export interface GoertzelResult {
  freq: number;
  coeff: number;
  rawPower: number;
  normalizedPower: number;
  q1: number;
  q2: number;
}

/**
 * Goertzel recurrence at an exact (non-integer-bin) frequency.
 * coeff = 2*cos(2*pi*f/fs); s = x + coeff*q1 - q2; power = q1^2+q2^2-coeff*q1*q2.
 * Rectangular window; normalized power = raw * 2 / N^2.
 */
export function goertzel(samples: ArrayLike<number>, freq: number, sampleRate: number): GoertzelResult {
  const n = samples.length;
  const coeff = 2 * Math.cos((2 * Math.PI * freq) / sampleRate);
  let q1 = 0;
  let q2 = 0;
  for (let i = 0; i < n; i++) {
    const s = samples[i] + coeff * q1 - q2;
    q2 = q1;
    q1 = s;
  }
  let raw = q1 * q1 + q2 * q2 - coeff * q1 * q2;
  if (raw < 0) {
    if (raw > -NEGATIVE_POWER_TOLERANCE * Math.max(1, q1 * q1 + q2 * q2)) {
      raw = 0;
    }
  }
  return { freq, coeff, rawPower: raw, normalizedPower: (raw * 2) / (n * n), q1, q2 };
}

/** Direct sine/cosine sum (independent reference for tests). */
export function directPower(samples: ArrayLike<number>, freq: number, sampleRate: number): number {
  const n = samples.length;
  const w = (2 * Math.PI * freq) / sampleRate;
  let re = 0;
  let im = 0;
  for (let i = 0; i < n; i++) {
    re += samples[i] * Math.cos(w * i);
    im -= samples[i] * Math.sin(w * i);
  }
  return re * re + im * im;
}

export interface TracePoint {
  index: number;
  input: number;
  s: number;
  q1: number;
  q2: number;
}

/** Bounded trace of recurrence states; full analysis always uses all samples. */
export function goertzelTrace(
  samples: ArrayLike<number>,
  freq: number,
  sampleRate: number,
  limit = 50,
): { freq: number; coeff: number; points: TracePoint[]; truncated: boolean; total: number } {
  const n = samples.length;
  const maxPoints = Math.max(1, Math.min(Math.floor(limit), 1000));
  const coeff = 2 * Math.cos((2 * Math.PI * freq) / sampleRate);
  let q1 = 0;
  let q2 = 0;
  const points: TracePoint[] = [];
  for (let i = 0; i < n; i++) {
    const s = samples[i] + coeff * q1 - q2;
    q2 = q1;
    q1 = s;
    if (points.length < maxPoints) {
      points.push({ index: i, input: samples[i], s, q1, q2 });
    }
  }
  return { freq, coeff, points, truncated: n > maxPoints, total: n };
}
