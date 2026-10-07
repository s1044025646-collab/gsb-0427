import { test } from "node:test";
import assert from "node:assert/strict";
import { ALL_FREQS, SAMPLE_RATE, goertzelPower } from "../src/goertzel";
import { ValidationError, analyze, validateSamples } from "../src/dtmf";
import { synthesizeDualTone, synthesizeKey, synthesizeSilence, synthesizeSingleTone } from "../src/fixtures";

const KEYS = ["1","2","3","A","4","5","6","B","7","8","9","C","*","0","#","D"];

/** Independent reference: direct sum X = sum x[n] * exp(-i*2*pi*f*n/fs), power = |X|^2. */
function directPower(samples: number[] | Float64Array, freq: number, fs = SAMPLE_RATE): number {
  let re = 0;
  let im = 0;
  for (let n = 0; n < samples.length; n++) {
    const w = (-2 * Math.PI * freq * n) / fs;
    re += samples[n] * Math.cos(w);
    im += samples[n] * Math.sin(w);
  }
  return re * re + im * im;
}

test("goertzel matches direct sin/cos sum at all 8 freqs within float tolerance", () => {
  const samples = Float64Array.from(synthesizeKey("5"));
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const demeaned = samples.map((v) => v - mean);
  for (const f of ALL_FREQS) {
    const g = goertzelPower(demeaned, f);
    const d = directPower(demeaned, f);
    const relErr = Math.abs(g.rawPower - d) / Math.max(d, 1e-300);
    assert.ok(relErr < 1e-9, `freq ${f}: goertzel=${g.rawPower} direct=${d} relErr=${relErr}`);
  }
});

test("all 16 standard keys are recognized", () => {
  for (const key of KEYS) {
    const report = analyze(validateSamples(synthesizeKey(key)));
    assert.equal(report.outcome, "KEY", `key ${key}: reasons=${report.reasons}`);
    assert.equal(report.key, key);
  }
});

test("dc offset is removed by demeaning", () => {
  const report = analyze(validateSamples(synthesizeKey("5", { dcOffset: 0.2 })));
  assert.equal(report.key, "5");
});

test("different phases still recognized", () => {
  for (const [pr, pc] of [[0.7, 2.1], [Math.PI / 2, 0], [3.0, -1.2]]) {
    const report = analyze(validateSamples(synthesizeKey("9", { phaseRow: pr, phaseCol: pc })));
    assert.equal(report.key, "9", `phases ${pr},${pc}`);
  }
});

test("shorter window (400 samples) still recognized", () => {
  const report = analyze(validateSamples(synthesizeKey("0", { length: 400 })));
  assert.equal(report.key, "0");
});

test("repeated analysis is deterministic", () => {
  const samples = validateSamples(synthesizeKey("3"));
  const a = analyze(samples);
  const b = analyze(samples);
  assert.deepEqual(a, b);
});

test("silence is rejected as SILENCE", () => {
  const report = analyze(validateSamples(synthesizeSilence()));
  assert.equal(report.outcome, "SILENCE");
  assert.ok(report.reasons.includes("SILENCE"));
});

test("single tone is rejected with insufficient dual-tone evidence", () => {
  const report = analyze(validateSamples(synthesizeSingleTone(770)));
  assert.equal(report.key, null);
  assert.ok(report.reasons.includes("COL_NO_DOMINANT") || report.reasons.includes("INSUFFICIENT_DUAL_TONE"));
});

test("severe amplitude imbalance is rejected", () => {
  const samples = synthesizeDualTone({ rowFreq: 770, colFreq: 1336, amplitude: 0.3, phaseCol: 0 }).map((_, i) => {
    const t = i / SAMPLE_RATE;
    return 0.3 * Math.sin(2 * Math.PI * 770 * t) + 0.01 * Math.sin(2 * Math.PI * 1336 * t);
  });
  const report = analyze(validateSamples(samples));
  assert.equal(report.key, null);
  assert.ok(report.reasons.includes("ENERGY_RATIO_OUT_OF_RANGE"));
});

test("non-finite input rejected", () => {
  const bad = synthesizeKey("5");
  bad[10] = NaN;
  assert.throws(() => validateSamples(bad), (e: unknown) => e instanceof ValidationError && e.code === "ERR_NONFINITE");
  bad[10] = Infinity;
  assert.throws(() => validateSamples(bad), (e: unknown) => e instanceof ValidationError && e.code === "ERR_NONFINITE");
});

test("out-of-range and bad length rejected", () => {
  assert.throws(() => validateSamples(new Array(640).fill(1.5)), (e: unknown) => e instanceof ValidationError && e.code === "ERR_RANGE");
  assert.throws(() => validateSamples(new Array(399).fill(0)), (e: unknown) => e instanceof ValidationError && e.code === "ERR_LENGTH");
  assert.throws(() => validateSamples(new Array(8001).fill(0)), (e: unknown) => e instanceof ValidationError && e.code === "ERR_LENGTH");
  assert.throws(() => validateSamples("nope"), (e: unknown) => e instanceof ValidationError && e.code === "ERR_BAD_PARAMS");
});

test("key 5 reports 770/1336 winners and judgment values", () => {
  const report = analyze(validateSamples(synthesizeKey("5")));
  assert.equal(report.row.winner.freq, 770);
  assert.equal(report.col.winner.freq, 1336);
  assert.ok(report.row.dominance >= 4);
  assert.ok(report.col.dominance >= 4);
  assert.ok(report.energyRatio! >= 0.25 && report.energyRatio! <= 4);
  assert.ok(report.dualToneFraction! >= 0.6);
});
