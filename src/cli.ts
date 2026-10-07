import * as fs from "node:fs";
import { ALL_FREQS, goertzelStates } from "./goertzel";
import { analyze, validateSamples } from "./dtmf";
import { synthesizeDualTone, synthesizeKey, synthesizeSilence, synthesizeSingleTone } from "./fixtures";
import * as db from "./db";
import { startServer } from "./api";

function print(obj: unknown): void {
  console.log(JSON.stringify(obj, null, 2));
}

function briefReport(r: ReturnType<typeof analyze>) {
  return {
    outcome: r.outcome,
    key: r.key,
    reasons: r.reasons,
    rms: r.rms,
    rowWinner: { freq: r.row.winner.freq, raw: r.row.winner.rawPower, norm: r.row.winner.normalizedPower, dominance: r.row.dominance },
    colWinner: { freq: r.col.winner.freq, raw: r.col.winner.rawPower, norm: r.col.winner.normalizedPower, dominance: r.col.dominance },
    energyRatio: r.energyRatio,
    dualToneFraction: r.dualToneFraction,
  };
}

function analyzeSamples(samples: number[], persist: boolean) {
  const valid = validateSamples(samples);
  const report = analyze(valid);
  let sampleId: number | null = null;
  let reportId: number | null = null;
  if (persist) {
    sampleId = db.saveSamples(Array.from(valid));
    reportId = db.saveReport(sampleId, { sampleRate: 8000, length: valid.length }, report);
  }
  return { report, sampleId, reportId };
}

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case "serve": {
      const port = args[0] ? Number(args[0]) : Number(process.env.PORT ?? 0);
      await startServer(port);
      break;
    }
    case "synth": {
      const key = args[0] ?? "5";
      const length = args[1] ? Number(args[1]) : 640;
      print({ key, length, samples: synthesizeKey(key, { length }) });
      break;
    }
    case "analyze": {
      // analyze <key> [length] [phaseRow] [phaseCol] [dcOffset]  | analyze --file <path>
      let samples: number[];
      if (args[0] === "--file") {
        samples = JSON.parse(fs.readFileSync(args[1], "utf8")) as number[];
      } else {
        samples = synthesizeKey(args[0] ?? "5", {
          length: args[1] ? Number(args[1]) : 640,
          phaseRow: args[2] ? Number(args[2]) : 0,
          phaseCol: args[3] ? Number(args[3]) : 0,
          dcOffset: args[4] ? Number(args[4]) : 0,
        });
      }
      const { report, sampleId, reportId } = analyzeSamples(samples, true);
      print({ sampleId, reportId, ...briefReport(report) });
      break;
    }
    case "reject-demo":
    case "demo": {
      console.log("== key 5 (770 + 1336 Hz) ==");
      const r5 = analyzeSamples(synthesizeKey("5"), true);
      print({ sampleId: r5.sampleId, reportId: r5.reportId, ...briefReport(r5.report) });

      console.log("== single tone 770 Hz (rejected) ==");
      const r1 = analyzeSamples(synthesizeSingleTone(770), true);
      print({ sampleId: r1.sampleId, reportId: r1.reportId, ...briefReport(r1.report) });

      console.log("== silence (rejected) ==");
      const r2 = analyzeSamples(synthesizeSilence(), true);
      print({ sampleId: r2.sampleId, reportId: r2.reportId, ...briefReport(r2.report) });

      console.log("== severe amplitude imbalance 0.3 vs 0.01 (rejected) ==");
      const imbalanced = synthesizeDualTone({ rowFreq: 770, colFreq: 1336, amplitude: 0.3 }).map((v, i) => {
        const t = i / 8000;
        return 0.3 * Math.sin(2 * Math.PI * 770 * t) + 0.01 * Math.sin(2 * Math.PI * 1336 * t) + (v - v);
      });
      const r3 = analyzeSamples(imbalanced, true);
      print({ sampleId: r3.sampleId, reportId: r3.reportId, ...briefReport(r3.report) });
      break;
    }
    case "report": {
      const report = db.getReport(Number(args[0]));
      if (!report) throw new Error("report not found");
      print(report);
      break;
    }
    case "list": {
      print(db.listReports(args[0] ? Number(args[0]) : 50));
      break;
    }
    case "recompute": {
      const old = db.getReport(Number(args[0]));
      if (!old) throw new Error("report not found");
      const stored = db.getSamples(old.sample_id);
      if (!stored) throw new Error("original samples missing");
      const report = analyze(validateSamples(stored));
      const reportId = db.saveReport(old.sample_id, { recomputeOf: old.id }, report);
      print({ reportId, recomputeOf: old.id, ...briefReport(report) });
      break;
    }
    case "compare": {
      const a = db.getReport(Number(args[0]));
      const b = db.getReport(Number(args[1]));
      if (!a || !b) throw new Error("report not found");
      print({
        ids: [a.id, b.id],
        algoVersions: [a.algo_version, b.algo_version],
        keys: [a.summary.key, b.summary.key],
        sameKey: a.summary.key === b.summary.key,
        energyDiff: a.summary.energies.map((e, i) => ({
          freq: e.freq,
          diff: e.normalizedPower - b.summary.energies[i].normalizedPower,
        })),
      });
      break;
    }
    case "recurrence": {
      const sampleId = Number(args[0]);
      const freq = Number(args[1]);
      const limit = Math.min(args[2] ? Number(args[2]) : 20, 1000);
      if (!ALL_FREQS.includes(freq as never)) throw new Error(`freq must be one of ${ALL_FREQS.join(",")}`);
      const stored = db.getSamples(sampleId);
      if (!stored) throw new Error("sample not found");
      print({ sampleId, freq, limit, states: goertzelStates(Float64Array.from(stored), freq).slice(0, limit) });
      break;
    }
    case "export": {
      const report = db.getReport(Number(args[0]));
      if (!report) throw new Error("report not found");
      const out = args[1] ?? `report-${report.id}.json`;
      fs.writeFileSync(out, JSON.stringify(report, null, 2));
      console.log(`exported to ${out}`);
      break;
    }
    default:
      console.log(`Usage: node dist/src/cli.js <command>
  serve [port]            start API server (default: free port)
  synth <key> [length]    print synthetic window JSON
  analyze <key> [len] [phaseRow] [phaseCol] [dc]   synthesize, analyze, persist
  analyze --file <path>   analyze samples from JSON file
  demo                    key 5 + rejection demos (single tone, silence, imbalance)
  report <id>             show stored report
  list [limit]            list reports
  recompute <reportId>    re-analyze stored samples into a new report
  compare <id1> <id2>     compare two reports
  recurrence <sampleId> <freq> [limit]   show Goertzel states
  export <reportId> [out] export report JSON`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
