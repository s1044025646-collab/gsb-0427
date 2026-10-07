import {
  ALL_FREQS, ALGORITHM_VERSION, BALANCE_MAX, BALANCE_MIN, COL_FREQS,
  DOMINANCE_RATIO, ENERGY_SHARE_MIN, KEYPAD, MAX_SAMPLES, MIN_RMS,
  MIN_SAMPLES, ROW_FREQS, SAMPLE_RATE,
} from "./constants.js";
import { goertzel, GoertzelResult } from "./goertzel.js";

export type RejectCode =
  | "SILENT"
  | "ROW_NOT_DOMINANT"
  | "COL_NOT_DOMINANT"
  | "ROW_COL_IMBALANCE"
  | "INSUFFICIENT_DUAL_TONE_ENERGY"
  | "WINNER_TIE";

export interface FreqReport {
  freq: number;
  group: "row" | "col";
  coeff: number;
  rawPower: number;
  normalizedPower: number;
}

export interface AnalysisResult {
  algorithmVersion: string;
  sampleRate: number;
  length: number;
  mean: number;
  rms: number;
  meanSquare: number;
  key: string | null;
  status: "ok" | "silent" | "insufficient_evidence";
  rejectReasons: { code: RejectCode; message: string }[];
  rowWinner: { freq: number; normalizedPower: number } | null;
  colWinner: { freq: number; normalizedPower: number } | null;
  checks: {
    rmsOk: boolean;
    rowDominance: number | null;
    colDominance: number | null;
    rowDominanceOk: boolean;
    colDominanceOk: boolean;
    balanceRatio: number | null;
    balanceOk: boolean;
    energyShare: number | null;
    energyShareOk: boolean;
  };
  freqs: FreqReport[];
}

export class InputError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function validateSamples(input: unknown): number[] {
  if (!Array.isArray(input)) {
    throw new InputError("E_NOT_ARRAY", "samples must be an array of numbers");
  }
  if (input.length < MIN_SAMPLES || input.length > MAX_SAMPLES) {
    throw new InputError(
      "E_LENGTH",
      `samples length must be between ${MIN_SAMPLES} and ${MAX_SAMPLES}, got ${input.length}`,
    );
  }
  for (let i = 0; i < input.length; i++) {
    const v = input[i];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new InputError("E_NON_FINITE", `samples[${i}] is not a finite number`);
    }
    if (v < -1 || v > 1) {
      throw new InputError("E_RANGE", `samples[${i}]=${v} out of range [-1, 1]`);
    }
  }
  return input.slice();
}

const KEY_BY_PAIR = new Map<string, string>();
for (const [key, [r, c]] of Object.entries(KEYPAD)) {
  KEY_BY_PAIR.set(`${r},${c}`, key);
}

function topTwo(group: FreqReport[]): [FreqReport, FreqReport, boolean] {
  let first = group[0];
  let second = group[1];
  if (second.normalizedPower > first.normalizedPower) [first, second] = [second, first];
  let tie = first.normalizedPower === second.normalizedPower;
  for (let i = 2; i < group.length; i++) {
    const g = group[i];
    if (g.normalizedPower > first.normalizedPower) {
      second = first;
      first = g;
      tie = false;
    } else if (g.normalizedPower > second.normalizedPower) {
      second = g;
      tie = false;
    } else if (g.normalizedPower === first.normalizedPower) {
      tie = true;
    }
  }
  return [first, second, tie];
}

export function analyze(samplesInput: unknown): AnalysisResult {
  const samples = validateSamples(samplesInput);
  const n = samples.length;

  let sum = 0;
  for (const v of samples) sum += v;
  const mean = sum / n;
  const centered = new Float64Array(n);
  let sq = 0;
  for (let i = 0; i < n; i++) {
    centered[i] = samples[i] - mean;
    sq += centered[i] * centered[i];
  }
  const meanSquare = sq / n;
  const rms = Math.sqrt(meanSquare);

  const results: GoertzelResult[] = ALL_FREQS.map((f) => goertzel(centered, f, SAMPLE_RATE));
  const freqs: FreqReport[] = results.map((r) => ({
    freq: r.freq,
    group: (ROW_FREQS as readonly number[]).includes(r.freq) ? "row" : "col",
    coeff: r.coeff,
    rawPower: r.rawPower,
    normalizedPower: r.normalizedPower,
  }));

  const rows = freqs.filter((f) => f.group === "row");
  const cols = freqs.filter((f) => f.group === "col");
  const [rowFirst, rowSecond, rowTie] = topTwo(rows);
  const [colFirst, colSecond, colTie] = topTwo(cols);

  const rejectReasons: AnalysisResult["rejectReasons"] = [];
  const rmsOk = rms >= MIN_RMS;
  if (!rmsOk) {
    rejectReasons.push({
      code: "SILENT",
      message: `de-meaned RMS ${rms} below minimum ${MIN_RMS}`,
    });
  }

  if (rowTie) {
    rejectReasons.push({ code: "WINNER_TIE", message: "row group winner tie" });
  }
  if (colTie) {
    rejectReasons.push({ code: "WINNER_TIE", message: "column group winner tie" });
  }

  const ratio = (a: number, b: number): number | null => {
    if (b === 0) return a === 0 ? null : Infinity;
    return a / b;
  };
  const rowDominance = ratio(rowFirst.normalizedPower, rowSecond.normalizedPower);
  const colDominance = ratio(colFirst.normalizedPower, colSecond.normalizedPower);
  const rowDominanceOk = !rowTie && rowDominance !== null && rowDominance >= DOMINANCE_RATIO;
  const colDominanceOk = !colTie && colDominance !== null && colDominance >= DOMINANCE_RATIO;
  if (!rowDominanceOk && !rowTie) {
    rejectReasons.push({
      code: "ROW_NOT_DOMINANT",
      message: `row dominance ${String(rowDominance)} below ${DOMINANCE_RATIO}`,
    });
  }
  if (!colDominanceOk && !colTie) {
    rejectReasons.push({
      code: "COL_NOT_DOMINANT",
      message: `column dominance ${String(colDominance)} below ${DOMINANCE_RATIO}`,
    });
  }

  let balanceRatio: number | null = null;
  let balanceOk = false;
  if (colFirst.normalizedPower > 0) {
    balanceRatio = rowFirst.normalizedPower / colFirst.normalizedPower;
    balanceOk = balanceRatio >= BALANCE_MIN && balanceRatio <= BALANCE_MAX;
  } else if (rowFirst.normalizedPower === 0) {
    balanceRatio = null;
    balanceOk = false;
  }
  if (!balanceOk) {
    rejectReasons.push({
      code: "ROW_COL_IMBALANCE",
      message: `row/col energy ratio ${String(balanceRatio)} outside [${BALANCE_MIN}, ${BALANCE_MAX}]`,
    });
  }

  let energyShare: number | null = null;
  let energyShareOk = false;
  if (meanSquare > 0) {
    energyShare = (rowFirst.normalizedPower + colFirst.normalizedPower) / meanSquare;
    energyShareOk = energyShare >= ENERGY_SHARE_MIN;
  }
  if (!energyShareOk) {
    rejectReasons.push({
      code: "INSUFFICIENT_DUAL_TONE_ENERGY",
      message: `winner energy share ${String(energyShare)} below ${ENERGY_SHARE_MIN}`,
    });
  }

  let key: string | null = null;
  let status: AnalysisResult["status"] = "insufficient_evidence";
  if (!rmsOk) {
    status = "silent";
  } else if (rejectReasons.length === 0) {
    key = KEY_BY_PAIR.get(`${rowFirst.freq},${colFirst.freq}`) ?? null;
    status = key ? "ok" : "insufficient_evidence";
  }

  return {
    algorithmVersion: ALGORITHM_VERSION,
    sampleRate: SAMPLE_RATE,
    length: n,
    mean,
    rms,
    meanSquare,
    key,
    status,
    rejectReasons,
    rowWinner: { freq: rowFirst.freq, normalizedPower: rowFirst.normalizedPower },
    colWinner: { freq: colFirst.freq, normalizedPower: colFirst.normalizedPower },
    checks: {
      rmsOk,
      rowDominance,
      colDominance,
      rowDominanceOk,
      colDominanceOk,
      balanceRatio,
      balanceOk,
      energyShare,
      energyShareOk,
    },
    freqs,
  };
}
