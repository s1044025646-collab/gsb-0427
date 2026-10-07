import test from "node:test";
import assert from "node:assert/strict";
import { analyze, InputError } from "../src/dtmf.js";
import { directPower, goertzel } from "../src/goertzel.js";
import { synthesize } from "../src/synth.js";
import { Store } from "../src/db.js";
import { ALL_FREQS, KEYPAD, SAMPLE_RATE } from "../src/constants.js";
import { rmSync } from "node:fs";

test("all 16 standard keys are recognized", () => {
  for (const key of Object.keys(KEYPAD)) {
    const { samples } = synthesize({ key });
    const r = analyze(samples);
    assert.equal(r.status, "ok", `key ${key}: ${JSON.stringify(r.rejectReasons)}`);
    assert.equal(r.key, key);
    assert.equal(r.rowWinner!.freq, KEYPAD[key][0]);
    assert.equal(r.colWinner!.freq, KEYPAD[key][1]);
  }
});

test("goertzel matches independent direct sine/cosine sum within float tolerance", () => {
  const { samples } = synthesize({ key: "5", dcOffset: 0.05, phaseRow: 0.7, phaseCol: -1.2 });
  const n = samples.length;
  const mean = samples.reduce((a, b) => a + b, 0) / n;
  const centered = samples.map((v) => v - mean);
  for (const f of ALL_FREQS) {
    const g = goertzel(centered, f, SAMPLE_RATE);
    const d = directPower(centered, f, SAMPLE_RATE);
    const tol = 1e-6 * Math.max(1, d);
    assert.ok(Math.abs(g.rawPower - d) <= tol, `freq ${f}: goertzel=${g.rawPower} direct=${d}`);
  }
});

test("dc offset is removed by de-meaning", () => {
  const clean = analyze(synthesize({ key: "5" }).samples);
  const offset = analyze(synthesize({ key: "5", dcOffset: 0.2 }).samples);
  assert.equal(offset.key, "5");
  assert.ok(Math.abs(offset.rms - clean.rms) < 1e-12);
});

test("different phases still detect key", () => {
  for (const [pr, pc] of [[0, 0], [1.1, 2.3], [-2.0, 0.4], [3.0, -3.0]]) {
    const r = analyze(synthesize({ key: "9", phaseRow: pr, phaseCol: pc }).samples);
    assert.equal(r.key, "9", `phases ${pr},${pc}`);
  }
});

test("shorter window (400 samples) still works", () => {
  const r = analyze(synthesize({ key: "0", length: 400 }).samples);
  assert.equal(r.key, "0");
});

test("repeated analysis is deterministic", () => {
  const { samples } = synthesize({ key: "B" });
  const a = analyze(samples);
  const b = analyze(samples);
  assert.deepEqual(a, b);
});

test("non-finite and out-of-range inputs are rejected", () => {
  const base = synthesize({ key: "5" }).samples;
  for (const bad of [NaN, Infinity, -Infinity]) {
    const s = base.slice();
    s[10] = bad;
    assert.throws(() => analyze(s), (e: unknown) => e instanceof InputError && e.code === "E_NON_FINITE");
  }
  for (const bad of [1.5, -2]) {
    const s = base.slice();
    s[10] = bad;
    assert.throws(() => analyze(s), (e: unknown) => e instanceof InputError && e.code === "E_RANGE");
  }
  assert.throws(() => analyze(new Array(399).fill(0.1)), (e: unknown) => (e as InputError).code === "E_LENGTH");
  assert.throws(() => analyze(new Array(8001).fill(0.1)), (e: unknown) => (e as InputError).code === "E_LENGTH");
  assert.throws(() => analyze("nope"), (e: unknown) => (e as InputError).code === "E_NOT_ARRAY");
});

test("silence is rejected as SILENT", () => {
  const r = analyze(new Array(640).fill(0));
  assert.equal(r.status, "silent");
  assert.equal(r.key, null);
  assert.ok(r.rejectReasons.some((x) => x.code === "SILENT"));
});

test("single tone is rejected (insufficient dual-tone evidence)", () => {
  const r = analyze(synthesize({ freqs: [770], amplitudes: [0.3] }).samples);
  assert.equal(r.key, null);
  assert.ok(r.rejectReasons.some((x) => x.code === "COL_NOT_DOMINANT" || x.code === "INSUFFICIENT_DUAL_TONE_ENERGY"));
});

test("severe amplitude imbalance is rejected", () => {
  const r = analyze(synthesize({ key: "5", rowAmplitude: 0.5, colAmplitude: 0.02 }).samples);
  assert.equal(r.key, null);
  assert.ok(r.rejectReasons.some((x) => x.code === "ROW_COL_IMBALANCE"));
});

test("invalid windows are never written as partial reports", () => {
  const store = new Store(":memory:");
  assert.throws(() => analyze([1, 2, 3]));
  assert.equal(store.listReports().length, 0);
  assert.equal(store.listSamples().length, 0);
  store.close();
});

test("sqlite persistence: save, reanalyze, restart, read back", () => {
  const path = `./data/test-${process.pid}.sqlite`;
  const { samples } = synthesize({ key: "5" });
  let store = new Store(path);
  const sampleId = store.saveSamples(samples, { key: "5" }, SAMPLE_RATE);
  const reportId = store.saveReport(sampleId, analyze(samples));
  store.close();
  store = new Store(path);
  const row = store.getReport(reportId);
  assert.ok(row);
  const summary = JSON.parse(row!.summary);
  assert.equal(summary.key, "5");
  assert.equal(store.getSample(sampleId)!.length, 640);
  store.close();
  rmSync(path, { force: true });
});
