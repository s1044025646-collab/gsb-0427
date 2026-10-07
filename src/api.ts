import * as http from "node:http";
import { ALL_FREQS, SAMPLE_RATE, goertzelStates } from "./goertzel";
import { ValidationError, analyze, validateSamples } from "./dtmf";
import { synthesizeDualTone, synthesizeKey, synthesizeSilence, synthesizeSingleTone } from "./fixtures";
import * as db from "./db";

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(payload);
}

function sendError(res: http.ServerResponse, status: number, code: string, message: string): void {
  send(res, status, { error: { code, message } });
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ValidationError("ERR_BAD_JSON", "request body is not valid JSON");
  }
}

function analyzeAndPersist(samples: Float64Array, persist: boolean) {
  const report = analyze(samples);
  let sampleId: number | null = null;
  let reportId: number | null = null;
  if (persist) {
    sampleId = db.saveSamples(Array.from(samples));
    reportId = db.saveReport(sampleId, { sampleRate: SAMPLE_RATE, length: samples.length }, report);
  }
  return { report, sampleId, reportId };
}

export function createServer(): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    try {
      if (req.method === "GET" && path === "/api/health") {
        return send(res, 200, { ok: true, sampleRate: SAMPLE_RATE });
      }

      if (req.method === "GET" && path === "/api/frequencies") {
        return send(res, 200, {
          sampleRate: SAMPLE_RATE,
          rowFreqs: ALL_FREQS.slice(0, 4),
          colFreqs: ALL_FREQS.slice(4),
          thresholds: analyze(new Float64Array(400)).thresholds,
        });
      }

      if (req.method === "POST" && path === "/api/samples") {
        const body = (await readBody(req)) as { samples?: unknown };
        const samples = validateSamples(body.samples);
        const sampleId = db.saveSamples(Array.from(samples));
        return send(res, 201, { sampleId, length: samples.length });
      }

      if (req.method === "POST" && path === "/api/analyze") {
        const body = (await readBody(req)) as { samples?: unknown; sampleId?: number; persist?: boolean };
        const persist = body.persist !== false;
        let samples: Float64Array;
        if (body.sampleId !== undefined) {
          const stored = db.getSamples(Number(body.sampleId));
          if (!stored) return sendError(res, 404, "ERR_NOT_FOUND", `sample ${body.sampleId} not found`);
          samples = validateSamples(stored);
        } else {
          samples = validateSamples(body.samples);
        }
        return send(res, 200, analyzeAndPersist(samples, persist));
      }

      if (req.method === "POST" && path === "/api/synthesize") {
        const body = (await readBody(req)) as Record<string, unknown>;
        const kind = (body.kind as string) ?? "key";
        let samples: number[];
        if (kind === "key") {
          samples = synthesizeKey(String(body.key ?? "5"), body as never);
        } else if (kind === "dual") {
          samples = synthesizeDualTone({
            rowFreq: Number(body.rowFreq),
            colFreq: Number(body.colFreq),
            length: body.length !== undefined ? Number(body.length) : undefined,
            amplitude: body.amplitude !== undefined ? Number(body.amplitude) : undefined,
            phaseRow: body.phaseRow !== undefined ? Number(body.phaseRow) : undefined,
            phaseCol: body.phaseCol !== undefined ? Number(body.phaseCol) : undefined,
            dcOffset: body.dcOffset !== undefined ? Number(body.dcOffset) : undefined,
          });
        } else if (kind === "single") {
          samples = synthesizeSingleTone(Number(body.freq), Number(body.length ?? 640), Number(body.amplitude ?? 0.3));
        } else if (kind === "silence") {
          samples = synthesizeSilence(Number(body.length ?? 640));
        } else {
          return sendError(res, 400, "ERR_BAD_PARAMS", `unknown synthesize kind: ${kind}`);
        }
        return send(res, 200, { length: samples.length, samples });
      }

      if (req.method === "GET" && path === "/api/reports") {
        return send(res, 200, { reports: db.listReports(Number(url.searchParams.get("limit") ?? 50)) });
      }

      const reportMatch = path.match(/^\/api\/reports\/(\d+)$/);
      if (req.method === "GET" && reportMatch) {
        const report = db.getReport(Number(reportMatch[1]));
        if (!report) return sendError(res, 404, "ERR_NOT_FOUND", "report not found");
        return send(res, 200, report);
      }

      const recomputeMatch = path.match(/^\/api\/reports\/(\d+)\/recompute$/);
      if (req.method === "POST" && recomputeMatch) {
        const old = db.getReport(Number(recomputeMatch[1]));
        if (!old) return sendError(res, 404, "ERR_NOT_FOUND", "report not found");
        const stored = db.getSamples(old.sample_id);
        if (!stored) return sendError(res, 404, "ERR_NOT_FOUND", "original samples missing");
        const samples = validateSamples(stored);
        const report = analyze(samples);
        const reportId = db.saveReport(old.sample_id, { sampleRate: SAMPLE_RATE, length: samples.length, recomputeOf: old.id }, report);
        return send(res, 201, { reportId, recomputeOf: old.id, report });
      }

      const exportMatch = path.match(/^\/api\/reports\/(\d+)\/export$/);
      if (req.method === "GET" && exportMatch) {
        const report = db.getReport(Number(exportMatch[1]));
        if (!report) return sendError(res, 404, "ERR_NOT_FOUND", "report not found");
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="report-${report.id}.json"`,
        });
        return res.end(JSON.stringify(report, null, 2));
      }

      if (req.method === "GET" && path === "/api/compare") {
        const ids = (url.searchParams.get("ids") ?? "").split(",").map((s) => Number(s.trim())).filter((x) => Number.isInteger(x));
        if (ids.length < 2) return sendError(res, 400, "ERR_BAD_PARAMS", "provide ?ids=1,2");
        const reports = ids.map((id) => db.getReport(id));
        if (reports.some((r) => !r)) return sendError(res, 404, "ERR_NOT_FOUND", "one or more reports not found");
        const [a, b] = reports as NonNullable<(typeof reports)[number]>[];
        const energyDiff = a.summary.energies.map((e, i) => ({
          freq: e.freq,
          a: e.normalizedPower,
          b: b.summary.energies[i].normalizedPower,
          diff: e.normalizedPower - b.summary.energies[i].normalizedPower,
        }));
        return send(res, 200, {
          ids,
          algoVersions: [a.algo_version, b.algo_version],
          sameAlgoVersion: a.algo_version === b.algo_version,
          keys: [a.summary.key, b.summary.key],
          sameKey: a.summary.key === b.summary.key,
          energyDiff,
        });
      }

      if (req.method === "GET" && path === "/api/recurrence") {
        const sampleId = Number(url.searchParams.get("sampleId"));
        const freq = Number(url.searchParams.get("freq"));
        const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 1000);
        if (!ALL_FREQS.includes(freq as never)) {
          return sendError(res, 400, "ERR_BAD_PARAMS", `freq must be one of ${ALL_FREQS.join(",")}`);
        }
        const stored = db.getSamples(sampleId);
        if (!stored) return sendError(res, 404, "ERR_NOT_FOUND", "sample not found");
        const samples = validateSamples(stored);
        const states = goertzelStates(Float64Array.from(samples), freq).slice(0, limit);
        return send(res, 200, {
          sampleId,
          freq,
          limit,
          totalSteps: samples.length,
          note: "display is truncated by limit; full analysis always uses all samples",
          states,
        });
      }

      return sendError(res, 404, "ERR_NOT_FOUND", `no route for ${req.method} ${path}`);
    } catch (err) {
      if (err instanceof ValidationError) return sendError(res, 400, err.code, err.message);
      return sendError(res, 500, "ERR_INTERNAL", err instanceof Error ? err.message : String(err));
    }
  });
}

export function startServer(port = Number(process.env.PORT ?? 0)): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      const actual = typeof addr === "object" && addr ? addr.port : port;
      console.log(`DTMF API listening on http://127.0.0.1:${actual}`);
      resolve(actual);
    });
  });
}

if (require.main === module) {
  void startServer();
}
