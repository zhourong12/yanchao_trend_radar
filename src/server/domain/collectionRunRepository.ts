import { randomUUID } from "node:crypto";
import { initializeMysqlStore, isMysqlConfigured, mysqlPool } from "../infrastructure/mysqlStore";

export async function beginCollectionRun(trigger: "scheduled" | "manual" | "test" = "manual") {
  if (!isMysqlConfigured()) return undefined;
  await initializeMysqlStore();
  const id = randomUUID();
  await mysqlPool().query(
    "INSERT INTO collection_runs (id, trigger_type, status, started_at) VALUES (?, ?, 'running', ?)",
    [id, trigger, new Date()]
  );
  return id;
}

export async function completeCollectionRun(
  id: string | undefined,
  result: { rawCount: number; mappedCount: number; errorCount: number; summary?: unknown }
) {
  if (!id || !isMysqlConfigured()) return;
  const status = result.errorCount > 0 ? (result.rawCount > 0 ? "partial" : "failed") : "succeeded";
  await mysqlPool().query(
    `UPDATE collection_runs SET status = ?, completed_at = ?, raw_count = ?, mapped_count = ?,
      error_count = ?, summary_json = CAST(? AS JSON) WHERE id = ?`,
    [
      status,
      new Date(),
      result.rawCount,
      result.mappedCount,
      result.errorCount,
      JSON.stringify(result.summary ?? {}),
      id
    ]
  );
}

export async function failCollectionRun(id: string | undefined, error: unknown) {
  if (!id || !isMysqlConfigured()) return;
  await mysqlPool().query(
    "UPDATE collection_runs SET status = 'failed', completed_at = ?, error_count = 1, summary_json = CAST(? AS JSON) WHERE id = ?",
    [new Date(), JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), id]
  );
}
