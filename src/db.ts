import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ALGORITHM_VERSION } from "./constants.js";
import { AnalysisResult } from "./dtmf.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB = join(__dirname, "..", "..", "data", "dtmf.sqlite");

export interface SampleRow {
  id: number;
  created_at: string;
  sample_rate: number;
  length: number;
  params: string;
  samples: string;
}

export interface ReportRow {
  id: number;
  sample_id: number;
  created_at: string;
  algorithm_version: string;
  result_key: string | null;
  status: string;
  summary: string;
}

export class Store {
  db: DatabaseSync;
  constructor(path: string = process.env.DTMF_DB ?? DEFAULT_DB) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS samples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        sample_rate INTEGER NOT NULL,
        length INTEGER NOT NULL,
        params TEXT NOT NULL,
        samples TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sample_id INTEGER NOT NULL REFERENCES samples(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        algorithm_version TEXT NOT NULL,
        result_key TEXT,
        status TEXT NOT NULL,
        summary TEXT NOT NULL
      );
    `);
  }

  saveSamples(samples: number[], params: Record<string, unknown>, sampleRate: number): number {
    const stmt = this.db.prepare(
      "INSERT INTO samples (sample_rate, length, params, samples) VALUES (?, ?, ?, ?)",
    );
    const info = stmt.run(sampleRate, samples.length, JSON.stringify(params), JSON.stringify(samples));
    return Number(info.lastInsertRowid);
  }

  getSample(id: number): SampleRow | undefined {
    return this.db.prepare("SELECT * FROM samples WHERE id = ?").get(id) as SampleRow | undefined;
  }

  listSamples(limit = 50): Omit<SampleRow, "samples">[] {
    return this.db
      .prepare("SELECT id, created_at, sample_rate, length, params FROM samples ORDER BY id DESC LIMIT ?")
      .all(limit) as Omit<SampleRow, "samples">[];
  }

  saveReport(sampleId: number, result: AnalysisResult): number {
    const stmt = this.db.prepare(
      "INSERT INTO reports (sample_id, algorithm_version, result_key, status, summary) VALUES (?, ?, ?, ?, ?)",
    );
    const info = stmt.run(
      sampleId,
      ALGORITHM_VERSION,
      result.key,
      result.status,
      JSON.stringify(result),
    );
    return Number(info.lastInsertRowid);
  }

  getReport(id: number): ReportRow | undefined {
    return this.db.prepare("SELECT * FROM reports WHERE id = ?").get(id) as ReportRow | undefined;
  }

  listReports(sampleId?: number, limit = 50): Omit<ReportRow, "summary">[] {
    if (sampleId !== undefined) {
      return this.db
        .prepare(
          "SELECT id, sample_id, created_at, algorithm_version, result_key, status FROM reports WHERE sample_id = ? ORDER BY id DESC LIMIT ?",
        )
        .all(sampleId, limit) as Omit<ReportRow, "summary">[];
    }
    return this.db
      .prepare(
        "SELECT id, sample_id, created_at, algorithm_version, result_key, status FROM reports ORDER BY id DESC LIMIT ?",
      )
      .all(limit) as Omit<ReportRow, "summary">[];
  }

  close(): void {
    this.db.close();
  }
}
