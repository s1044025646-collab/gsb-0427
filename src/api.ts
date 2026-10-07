import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import { analyze, InputError } from "./dtmf.js";
import { goertzelTrace } from "./goertzel.js";
import { Store } from "./db.js";
import { synthesize } from "./synth.js";
import { SAMPLE_RATE } from "./constants.js";

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw new InputError("E_JSON", "request body is not valid JSON");
  }
}

export function createApi(store: Store) {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    const method = req.method ?? "GET";
    try {
      if (method === "GET" && path === "/api/health") {
        return send(res, 200, { ok: true });
      }

      if (method === "POST" && path === "/api/synth") {
        const body = (await readBody(req)) as Record<string, unknown>;
        const { samples, params } = synthesize(body);
        const out: Record<string, unknown> = { samples, params };
        if (body.analyze) {
          const result = analyze(samples);
          out.analysis = result;
          if (body.save) {
            const sampleId = store.saveSamples(samples, params, SAMPLE_RATE);
            const reportId = store.saveReport(sampleId, result);
            out.sampleId = sampleId;
            out.reportId = reportId;
          }
        }
        return send(res, 200, out);
      }

      if (method === "POST" && path === "/api/analyze") {
        const body = (await readBody(req)) as { samples?: unknown; save?: boolean; params?: Record<string, unknown> };
        const result = analyze(body.samples);
        const out: Record<string, unknown> = { analysis: result };
        if (body.save) {
          const sampleId = store.saveSamples(body.samples as number[], body.params ?? {}, SAMPLE_RATE);
          const reportId = store.saveReport(sampleId, result);
          out.sampleId = sampleId;
          out.reportId = reportId;
        }
        return send(res, 200, out);
      }

      if (method === "POST" && path === "/api/samples") {
        const body = (await readBody(req)) as { samples?: unknown; params?: Record<string, unknown> };
        const { validateSamples } = await import("./dtmf.js");
        const samples = validateSamples(body.samples);
        const id = store.saveSamples(samples, body.params ?? {}, SAMPLE_RATE);
        return send(res, 201, { id });
      }

      const sampleMatch = path.match(/^\/api\/samples\/(\d+)(\/analyze|\/compare)?$/);
      if (sampleMatch) {
        const id = Number(sampleMatch[1]);
        const row = store.getSample(id);
        if (!row) return send(res, 404, { error: { code: "E_NOT_FOUND", message: `sample ${id} not found` } });
        const action = sampleMatch[2];
        if (method === "GET" && !action) {
          return send(res, 200, { ...row, samples: JSON.parse(row.samples), params: JSON.parse(row.params) });
        }
        if (method === "POST" && action === "/analyze") {
          const result = analyze(JSON.parse(row.samples));
          const reportId = store.saveReport(id, result);
          return send(res, 201, { reportId, analysis: result });
        }
        if (method === "GET" && action === "/compare") {
          const reports = store.listReports(id, 1000);
          const full = reports.map((r) => {
            const row2 = store.getReport(r.id);
            const summary = JSON.parse(row2!.summary);
            return {
              reportId: r.id,
              createdAt: r.created_at,
              algorithmVersion: r.algorithm_version,
              key: summary.key,
              status: summary.status,
              checks: summary.checks,
              rowWinner: summary.rowWinner,
              colWinner: summary.colWinner,
            };
          });
          const keys = new Set(full.map((f) => `${f.algorithmVersion}:${f.key}:${f.status}`));
          return send(res, 200, { sampleId: id, consistent: keys.size <= 1, reports: full });
        }
      }

      if (method === "GET" && path === "/api/samples") {
        return send(res, 200, { samples: store.listSamples() });
      }

      if (method === "GET" && path === "/api/reports") {
        const sid = url.searchParams.get("sampleId");
        return send(res, 200, { reports: store.listReports(sid ? Number(sid) : undefined) });
      }

      const reportMatch = path.match(/^\/api\/reports\/(\d+)(\/export)?$/);
      if (method === "GET" && reportMatch) {
        const row = store.getReport(Number(reportMatch[1]));
        if (!row) return send(res, 404, { error: { code: "E_NOT_FOUND", message: "report not found" } });
        const body = { ...row, summary: JSON.parse(row.summary) };
        if (reportMatch[2] === "/export") {
          return send(res, 200, body, {
            "content-disposition": `attachment; filename="dtmf-report-${row.id}.json"`,
          });
        }
        return send(res, 200, body);
      }

      if (method === "GET" && path === "/api/trace") {
        const sampleId = Number(url.searchParams.get("sampleId"));
        const freq = Number(url.searchParams.get("freq"));
        const limit = Number(url.searchParams.get("limit") ?? "50");
        if (!Number.isFinite(freq)) {
          return send(res, 400, { error: { code: "E_PARAM", message: "freq query param required" } });
        }
        const row = store.getSample(sampleId);
        if (!row) return send(res, 404, { error: { code: "E_NOT_FOUND", message: "sample not found" } });
        const trace = goertzelTrace(JSON.parse(row.samples), freq, SAMPLE_RATE, limit);
        return send(res, 200, trace);
      }

      return send(res, 404, { error: { code: "E_NOT_FOUND", message: `${method} ${path} not found` } });
    } catch (err) {
      if (err instanceof InputError) {
        return send(res, 400, { error: { code: err.code, message: err.message } });
      }
      return send(res, 500, { error: { code: "E_INTERNAL", message: String(err) } });
    }
  });
}

export async function startServer(port = Number(process.env.PORT ?? 0)): Promise<{ port: number; close: () => void }> {
  const store = new Store();
  const server = createApi(store);
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  return { port: addr.port, close: () => { server.close(); store.close(); } };
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, "/")}`).href) {
  const { port } = await startServer();
  console.log(`DTMF API listening on http://127.0.0.1:${port}`);
}
