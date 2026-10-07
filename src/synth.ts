import { KEYPAD, SAMPLE_RATE } from "./constants.js";
import { InputError } from "./dtmf.js";

export interface SynthOptions {
  key?: string;
  rowFreq?: number;
  colFreq?: number;
  length?: number;
  amplitude?: number;
  rowAmplitude?: number;
  colAmplitude?: number;
  phaseRow?: number;
  phaseCol?: number;
  dcOffset?: number;
  freqs?: number[];
  amplitudes?: number[];
}

/** Local synthetic tone fixture; no audio files needed. */
export function synthesize(opts: SynthOptions = {}): { samples: number[]; params: Record<string, unknown> } {
  const length = opts.length ?? 640;
  if (!Number.isInteger(length) || length < 1 || length > 100000) {
    throw new InputError("E_LENGTH", "synth length must be an integer in [1, 100000]");
  }
  let freqs: number[];
  let amps: number[];
  if (opts.freqs) {
    freqs = opts.freqs;
    amps = opts.amplitudes ?? freqs.map(() => 0.3);
    if (amps.length !== freqs.length) {
      throw new InputError("E_PARAM", "amplitudes length must match freqs length");
    }
  } else if (opts.key !== undefined) {
    const pair = KEYPAD[opts.key];
    if (!pair) throw new InputError("E_KEY", `unknown key "${opts.key}"`);
    freqs = [...pair];
    amps = [opts.rowAmplitude ?? opts.amplitude ?? 0.3, opts.colAmplitude ?? opts.amplitude ?? 0.3];
  } else if (opts.rowFreq !== undefined && opts.colFreq !== undefined) {
    freqs = [opts.rowFreq, opts.colFreq];
    amps = [opts.rowAmplitude ?? opts.amplitude ?? 0.3, opts.colAmplitude ?? opts.amplitude ?? 0.3];
  } else {
    throw new InputError("E_PARAM", "provide key, rowFreq+colFreq, or freqs");
  }
  for (const f of freqs) {
    if (!Number.isFinite(f) || f <= 0 || f >= SAMPLE_RATE / 2) {
      throw new InputError("E_PARAM", `freq ${f} must be in (0, ${SAMPLE_RATE / 2})`);
    }
  }
  const dcOffset = opts.dcOffset ?? 0;
  const phaseRow = opts.phaseRow ?? 0;
  const phaseCol = opts.phaseCol ?? 0;
  const samples = new Array<number>(length);
  for (let i = 0; i < length; i++) {
    let v = dcOffset;
    for (let k = 0; k < freqs.length; k++) {
      const phase = k === 0 ? phaseRow : k === 1 ? phaseCol : 0;
      v += amps[k] * Math.sin((2 * Math.PI * freqs[k] * i) / SAMPLE_RATE + phase);
    }
    samples[i] = v;
  }
  return { samples, params: { ...opts, length, freqs, amps, dcOffset } };
}
