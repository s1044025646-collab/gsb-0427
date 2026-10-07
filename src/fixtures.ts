import { COL_FREQS, ROW_FREQS, SAMPLE_RATE } from "./goertzel";
import { KEYPAD } from "./dtmf";

export interface SynthOptions {
  rowFreq: number;
  colFreq: number;
  length?: number; // default 640
  amplitude?: number; // per-tone amplitude, default 0.3
  phaseRow?: number; // radians, default 0
  phaseCol?: number;
  dcOffset?: number;
  sampleRate?: number;
}

export function synthesizeDualTone(opts: SynthOptions): number[] {
  const {
    rowFreq,
    colFreq,
    length = 640,
    amplitude = 0.3,
    phaseRow = 0,
    phaseCol = 0,
    dcOffset = 0,
    sampleRate = SAMPLE_RATE,
  } = opts;
  if (!ROW_FREQS.includes(rowFreq as never)) throw new Error(`rowFreq must be one of ${ROW_FREQS}`);
  if (!COL_FREQS.includes(colFreq as never)) throw new Error(`colFreq must be one of ${COL_FREQS}`);
  const out = new Array<number>(length);
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    out[i] =
      amplitude * Math.sin(2 * Math.PI * rowFreq * t + phaseRow) +
      amplitude * Math.sin(2 * Math.PI * colFreq * t + phaseCol) +
      dcOffset;
  }
  return out;
}

export function synthesizeKey(key: string, opts: Partial<SynthOptions> = {}): number[] {
  const entry = Object.entries(KEYPAD).find(([, k]) => k === key.toUpperCase());
  if (!entry) throw new Error(`unknown key: ${key}`);
  const [row, col] = entry[0].split(":").map(Number);
  return synthesizeDualTone({ rowFreq: row, colFreq: col, ...opts });
}

export function synthesizeSingleTone(freq: number, length = 640, amplitude = 0.3): number[] {
  const out = new Array<number>(length);
  for (let i = 0; i < length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE);
  return out;
}

export function synthesizeSilence(length = 640): number[] {
  return new Array<number>(length).fill(0);
}
