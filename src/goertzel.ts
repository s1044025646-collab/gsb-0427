export const SAMPLE_RATE = 8000;
export const ROW_FREQS = [697, 770, 852, 941] as const;
export const COL_FREQS = [1209, 1336, 1477, 1633] as const;
export const ALL_FREQS = [...ROW_FREQS, ...COL_FREQS] as const;

export const ALGO_VERSION = "goertzel-dtmf/1.0.0";

/** Tolerance for treating tiny negative powers (float noise) as zero. */
export const POWER_EPS = 1e-12;
/** Relative tolerance for declaring a tie between two winners. */
export const TIE_REL_TOL = 1e-9;

export interface FreqEnergy {
  freq: number;
  coeff: number;
  rawPower: number;
  normalizedPower: number;
}

/**
 * Goertzel recurrence at an arbitrary real frequency f (not rounded to a DFT bin).
 * coeff = 2*cos(2*pi*f/fs); q0 = coeff*q1 - q2 + x[n]; states start at zero.
 * Power = q1^2 + q2^2 - coeff*q1*q2. Normalized power = raw * 2 / N^2.
 */
export function goertzelPower(samples: Float64Array, freq: number, fs: number = SAMPLE_RATE): FreqEnergy {
  const n = samples.length;
  const coeff = 2 * Math.cos((2 * Math.PI * freq) / fs);
  let q1 = 0;
  let q2 = 0;
  for (let i = 0; i < n; i++) {
    const q0 = coeff * q1 - q2 + samples[i];
    q2 = q1;
    q1 = q0;
  }
  let raw = q1 * q1 + q2 * q2 - coeff * q1 * q2;
  if (raw < 0 && raw > -POWER_EPS) raw = 0; // tiny negative float noise
  return {
    freq,
    coeff,
    rawPower: raw,
    normalizedPower: (raw * 2) / (n * n),
  };
}

/** Recurrence states (q1, q2) after each step, for explanation purposes. */
export function goertzelStates(
  samples: Float64Array,
  freq: number,
  fs: number = SAMPLE_RATE,
): Array<{ n: number; q1: number; q2: number }> {
  const coeff = 2 * Math.cos((2 * Math.PI * freq) / fs);
  let q1 = 0;
  let q2 = 0;
  const out: Array<{ n: number; q1: number; q2: number }> = [];
  for (let i = 0; i < samples.length; i++) {
    const q0 = coeff * q1 - q2 + samples[i];
    q2 = q1;
    q1 = q0;
    out.push({ n: i + 1, q1, q2 });
  }
  return out;
}
