import { readFileSync, writeFileSync } from "node:fs";
import { analyze } from "./dtmf.js";
import { goertzelTrace } from "./goertzel.js";
import { Store } from "./db.js";
import { synthesize } from "./synth.js";
import { SAMPLE_RATE } from "./constants.js";

function parseArgs(argv: string[]): { positional: string[]; flags: Record<string, string | boolean> } {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function print(x: unknown): void {
  console.log(JSON.stringify(x, null, 2));
}

function loadSamples(flags: Record<string, string | boolean>): { samples: number[]; params: Record<string, unknown> } {
  if (flags.file) {
    const raw = JSON.parse(readFileSync(String(flags.file), "utf8"));
    const samples = Array.isArray(raw) ? raw : raw.samples;
    return { samples, params: { source: String(flags.file) } };
  }
  if (flags.samples) {
    return { samples: JSON.parse(String(flags.samples)), params: { source: "literal" } };
  }
  const synthOpts: Record<string, unknown> = {};
  if (flags.key !== undefined) synthOpts.key = String(flags.key);
  if (flags.length) synthOpts.length = Number(flags.length);
  if (flags.amplitude) synthOpts.amplitude = Number(flags.amplitude);
  if (flags["row-amplitude"]) synthOpts.rowAmplitude = Number(flags["row-amplitude"]);
  if (flags["col-amplitude"]) synthOpts.colAmplitude = Number(flags["col-amplitude"]);
  if (flags["dc-offset"]) synthOpts.dcOffset = Number(flags["dc-offset"]);
  if (flags["phase-row"]) synthOpts.phaseRow = Number(flags["phase-row"]);
  if (flags["phase-col"]) synthOpts.phaseCol = Number(flags["phase-col"]);
  if (flags.freqs) synthOpts.freqs = String(flags.freqs).split(",").map(Number);
  if (flags.amplitudes) synthOpts.amplitudes = String(flags.amplitudes).split(",").map(Number);
  return synthesize(synthOpts);
}

const USAGE = `dtmf CLI
  synth   --key 5 [--length 640] [--analyze] [--save]
  analyze (--key 5 | --file f.json | --samples "[...]") [--save]
  save    (--key 5 | --file f.json | --samples "[...]")
  samples | show-sample <id>
  reports [--sample <id>] | show-report <id>
  reanalyze <sampleId>
  compare <sampleId>
  trace <sampleId> --freq 770 [--limit 20]
  export <reportId> [--out report.json]
  demo
`;

export function runCli(argv: string[], store = new Store()): void {
  const [cmd, ...rest] = argv;
  const { positional, flags } = parseArgs(rest);
  switch (cmd) {
    case "synth": {
      const { samples, params } = loadSamples(flags);
      const out: Record<string, unknown> = { params, samples };
      if (flags.analyze) out.analysis = analyze(samples);
      if (flags.save) {
        const sampleId = store.saveSamples(samples, params, SAMPLE_RATE);
        out.sampleId = sampleId;
        if (flags.analyze) out.reportId = store.saveReport(sampleId, analyze(samples));
      }
      print(out);
      break;
    }
    case "analyze": {
      const { samples, params } = loadSamples(flags);
      const result = analyze(samples);
      const out: Record<string, unknown> = { analysis: result };
      if (flags.save) {
        const sampleId = store.saveSamples(samples, params, SAMPLE_RATE);
        out.sampleId = sampleId;
        out.reportId = store.saveReport(sampleId, result);
      }
      print(out);
      break;
    }
    case "save": {
      const { samples, params } = loadSamples(flags);
      print({ sampleId: store.saveSamples(samples, params, SAMPLE_RATE) });
      break;
    }
    case "samples":
      print(store.listSamples());
      break;
    case "show-sample": {
      const row = store.getSample(Number(positional[0]));
      if (!row) throw new Error(`sample ${positional[0]} not found`);
      print({ ...row, samples: JSON.parse(row.samples), params: JSON.parse(row.params) });
      break;
    }
    case "reports":
      print(store.listReports(flags.sample ? Number(flags.sample) : undefined));
      break;
    case "show-report": {
      const row = store.getReport(Number(positional[0]));
      if (!row) throw new Error(`report ${positional[0]} not found`);
      print({ ...row, summary: JSON.parse(row.summary) });
      break;
    }
    case "reanalyze": {
      const row = store.getSample(Number(positional[0]));
      if (!row) throw new Error(`sample ${positional[0]} not found`);
      const result = analyze(JSON.parse(row.samples));
      print({ reportId: store.saveReport(row.id, result), analysis: result });
      break;
    }
    case "compare": {
      const id = Number(positional[0]);
      const reports = store.listReports(id, 1000).map((r) => {
        const summary = JSON.parse(store.getReport(r.id)!.summary);
        return { reportId: r.id, version: r.algorithm_version, key: summary.key, status: summary.status };
      });
      const distinct = new Set(reports.map((r) => `${r.version}:${r.key}:${r.status}`));
      print({ sampleId: id, consistent: distinct.size <= 1, reports });
      break;
    }
    case "trace": {
      const row = store.getSample(Number(positional[0]));
      if (!row) throw new Error(`sample ${positional[0]} not found`);
      print(goertzelTrace(JSON.parse(row.samples), Number(flags.freq), SAMPLE_RATE, Number(flags.limit ?? 50)));
      break;
    }
    case "export": {
      const row = store.getReport(Number(positional[0]));
      if (!row) throw new Error(`report ${positional[0]} not found`);
      const payload = JSON.stringify({ ...row, summary: JSON.parse(row.summary) }, null, 2);
      if (flags.out) {
        writeFileSync(String(flags.out), payload, "utf8");
        console.log(`written to ${String(flags.out)}`);
      } else {
        console.log(payload);
      }
      break;
    }
    default:
      process.stderr.write(USAGE);
      process.exitCode = cmd ? 1 : 0;
  }
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, "/")}`).href) {
  try {
    runCli(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
    process.exitCode = 1;
  }
}
