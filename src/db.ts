import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import { AnalysisReport } from "./dtmf";
import { ALGO_VERSION } from "./goertzel";

export const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "dtmf.sqlite");

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (!db) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    db = new DatabaseSync(DB_PATH);
    db.exec(`
      CREATE TABLE IF NOT EXISTS samples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sample_id INTEGER NOT NULL REFERENCES samples(id),
        algo_version TEXT NOT NULL,
        params TEXT NOT NULL,
        summary TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }
  return db;
}

export function saveSamples(samples: number[]): number {
  const stmt = getDb().prepare("INSERT INTO samples (data) VALUES (?)");
  const res = stmt.run(JSON.stringify(samples));
  return Number(res.lastInsertRowid);
}

export function getSamples(id: number): number[] | null {
  const row = getDb().prepare("SELECT data FROM samples WHERE id = ?").get(id) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as number[]) : null;
}

export function saveReport(sampleId: number, params: object, report: AnalysisReport): number {
  const stmt = getDb().prepare(
    "INSERT INTO reports (sample_id, algo_version, params, summary) VALUES (?, ?, ?, ?)",
  );
  const res = stmt.run(sampleId, ALGO_VERSION, JSON.stringify(params), JSON.stringify(report));
  return Number(res.lastInsertRowid);
}

export function getReport(id: number): { id: number; sample_id: number; algo_version: string; params: unknown; summary: AnalysisReport; created_at: string } | null {
  const row = getDb()
    .prepare("SELECT * FROM reports WHERE id = ?")
    .get(id) as { id: number; sample_id: number; algo_version: string; params: string; summary: string; created_at: string } | undefined;
  if (!row) return null;
  return { ...row, params: JSON.parse(row.params), summary: JSON.parse(row.summary) };
}

export function listReports(limit = 50): Array<{ id: number; sample_id: number; algo_version: string; key: string | null; outcome: string; created_at: string }> {
  const rows = getDb()
    .prepare("SELECT id, sample_id, algo_version, summary, created_at FROM reports ORDER BY id DESC LIMIT ?")
    .all(limit) as Array<{ id: number; sample_id: number; algo_version: string; summary: string; created_at: string }>;
  return rows.map((r) => {
    const s = JSON.parse(r.summary) as AnalysisReport;
    return { id: r.id, sample_id: r.sample_id, algo_version: r.algo_version, key: s.key, outcome: s.outcome, created_at: r.created_at };
  });
}
