import {
  ALL_FREQS,
  COL_FREQS,
  FreqEnergy,
  ROW_FREQS,
  SAMPLE_RATE,
  TIE_REL_TOL,
  goertzelPower,
} from "./goertzel";

export const MIN_SAMPLES = 400;
export const MAX_SAMPLES = 8000;
export const RMS_MIN = 0.01;
export const DOMINANCE_RATIO = 4;
export const ENERGY_RATIO_MIN = 0.25;
export const ENERGY_RATIO_MAX = 4;
export const DUAL_TONE_FRACTION = 0.6;

export const KEYPAD: Record<string, string> = {
  "697:1209": "1", "697:1336": "2", "697:1477": "3", "697:1633": "A",
  "770:1209": "4", "770:1336": "5", "770:1477": "6", "770:1633": "B",
  "852:1209": "7", "852:1336": "8", "852:1477": "9", "852:1633": "C",
  "941:1209": "*", "941:1336": "0", "941:1477": "#", "941:1633": "D",
};

export type ReasonCode =
  | "OK"
  | "SILENCE"
  | "ROW_TIE"
  | "COL_TIE"
  | "ROW_NO_DOMINANT"
  | "COL_NO_DOMINANT"
  | "ENERGY_RATIO_OUT_OF_RANGE"
  | "INSUFFICIENT_DUAL_TONE";

export type Outcome = "KEY" | "SILENCE" | "INSUFFICIENT_EVIDENCE";

export class ValidationError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export function validateSamples(input: unknown): Float64Array {
  if (!Array.isArray(input)) {
    throw new ValidationError("ERR_BAD_PARAMS", "samples must be an array of numbers");
  }
  if (input.length < MIN_SAMPLES || input.length > MAX_SAMPLES) {
    throw new ValidationError(
      "ERR_LENGTH",
      `samples length must be between ${MIN_SAMPLES} and ${MAX_SAMPLES}, got ${input.length}`,
    );
  }
  for (let i = 0; i < input.length; i++) {
    const v = input[i];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new ValidationError("ERR_NONFINITE", `samples[${i}] is not a finite number`);
    }
    if (v < -1 || v > 1) {
      throw new ValidationError("ERR_RANGE", `samples[${i}]=${v} out of [-1, 1]`);
    }
  }
  return Float64Array.from(input as number[]);
}

interface GroupResult {
  freqs: FreqEnergy[];
  winner: FreqEnergy;
  runnerUp: FreqEnergy;
  tie: boolean;
  dominance: number; // winner / runnerUp, Infinity when runnerUp is 0
  dominant: boolean;
}

function pickWinner(energies: FreqEnergy[]): GroupResult {
  const sorted = [...energies].sort((a, b) => b.rawPower - a.rawPower);
  const winner = sorted[0];
  const runnerUp = sorted[1];
  const tie =
    winner.rawPower > 0 &&
    Math.abs(winner.rawPower - runnerUp.rawPower) <= TIE_REL_TOL * Math.max(winner.rawPower, 1e-300);
  const dominance = runnerUp.rawPower === 0 ? (winner.rawPower > 0 ? Infinity : 0) : winner.rawPower / runnerUp.rawPower;
  const dominant = !tie && winner.rawPower > 0 && dominance >= DOMINANCE_RATIO;
  return { freqs: energies, winner, runnerUp, tie, dominance, dominant };
}

export interface AnalysisReport {
  algoVersion: string;
  sampleRate: number;
  length: number;
  mean: number;
  rms: number;
  meanSquare: number;
  outcome: Outcome;
  key: string | null;
  reasons: ReasonCode[];
  row: GroupResult;
  col: GroupResult;
  energies: FreqEnergy[];
  energyRatio: number | null; // row winner / col winner raw power
  dualToneFraction: number | null; // (rowN + colN) / meanSquare
  thresholds: {
    rmsMin: number;
    dominanceRatio: number;
    energyRatioMin: number;
    energyRatioMax: number;
    dualToneFraction: number;
  };
}

export function analyze(samples: Float64Array): AnalysisReport {
  const n = samples.length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += samples[i];
  const mean = sum / n;
  const demeaned = new Float64Array(n);
  let sq = 0;
  for (let i = 0; i < n; i++) {
    demeaned[i] = samples[i] - mean;
    sq += demeaned[i] * demeaned[i];
  }
  const meanSquare = sq / n;
  const rms = Math.sqrt(meanSquare);

  const energies = ALL_FREQS.map((f) => goertzelPower(demeaned, f, SAMPLE_RATE));
  const row = pickWinner(energies.slice(0, ROW_FREQS.length));
  const col = pickWinner(energies.slice(ROW_FREQS.length));

  const reasons: ReasonCode[] = [];
  if (rms < RMS_MIN) reasons.push("SILENCE");
  if (row.tie) reasons.push("ROW_TIE");
  if (col.tie) reasons.push("COL_TIE");
  if (!row.tie && !row.dominant) reasons.push("ROW_NO_DOMINANT");
  if (!col.tie && !col.dominant) reasons.push("COL_NO_DOMINANT");

  let energyRatio: number | null = null;
  if (row.winner.rawPower > 0 && col.winner.rawPower > 0) {
    energyRatio = row.winner.rawPower / col.winner.rawPower;
    if (energyRatio < ENERGY_RATIO_MIN || energyRatio > ENERGY_RATIO_MAX) {
      reasons.push("ENERGY_RATIO_OUT_OF_RANGE");
    }
  } else {
    reasons.push("ENERGY_RATIO_OUT_OF_RANGE");
  }

  let dualToneFraction: number | null = null;
  if (meanSquare > 0) {
    dualToneFraction = (row.winner.normalizedPower + col.winner.normalizedPower) / meanSquare;
    if (dualToneFraction < DUAL_TONE_FRACTION) reasons.push("INSUFFICIENT_DUAL_TONE");
  } else {
    reasons.push("INSUFFICIENT_DUAL_TONE");
  }

  const ok = reasons.length === 0;
  const key = ok ? KEYPAD[`${row.winner.freq}:${col.winner.freq}`] ?? null : null;
  const outcome: Outcome = ok ? "KEY" : reasons.includes("SILENCE") && rms < RMS_MIN ? "SILENCE" : "INSUFFICIENT_EVIDENCE";

  return {
    algoVersion: "goertzel-dtmf/1.0.0",
    sampleRate: SAMPLE_RATE,
    length: n,
    mean,
    rms,
    meanSquare,
    outcome,
    key,
    reasons: ok ? ["OK"] : reasons,
    row,
    col,
    energies,
    energyRatio,
    dualToneFraction,
    thresholds: {
      rmsMin: RMS_MIN,
      dominanceRatio: DOMINANCE_RATIO,
      energyRatioMin: ENERGY_RATIO_MIN,
      energyRatioMax: ENERGY_RATIO_MAX,
      dualToneFraction: DUAL_TONE_FRACTION,
    },
  };
}
