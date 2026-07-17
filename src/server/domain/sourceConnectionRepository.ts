import type { SourceStatus } from "../../shared/types";
import type { RowDataPacket } from "mysql2/promise";
import { initializeMysqlStore, isMysqlConfigured, mysqlPool } from "../infrastructure/mysqlStore";

export async function persistSourceStatuses(statuses: SourceStatus[]) {
  if (!isMysqlConfigured()) return;
  await initializeMysqlStore();
  for (const source of statuses) {
    await mysqlPool().query(
      `INSERT INTO source_connections
       (source_id, label, status, last_checked_at, last_success_at, last_error)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE label = VALUES(label), status = VALUES(status),
         last_checked_at = VALUES(last_checked_at), last_success_at = VALUES(last_success_at), last_error = VALUES(last_error)`,
      [
        source.name,
        source.name,
        source.ok ? "ready" : "degraded",
        source.lastCheckedAt ? new Date(source.lastCheckedAt) : new Date(),
        source.ok ? new Date(source.lastCheckedAt ?? Date.now()) : null,
        source.error ?? null
      ]
    );
  }
}

export async function readSourceStatuses(): Promise<SourceStatus[]> {
  if (!isMysqlConfigured()) return [];
  await initializeMysqlStore();
  const [rows] = await mysqlPool().query<RowDataPacket[]>(
    "SELECT source_id, status, last_checked_at, last_error FROM source_connections ORDER BY source_id"
  );
  return rows.map((row) => ({
    name: String(row.source_id),
    ok: row.status === "ready",
    signalCount: 0,
    lastCheckedAt: mysqlDate(row.last_checked_at) ?? new Date(0).toISOString(),
    riskLevel: "medium",
    error: row.last_error ?? undefined
  }));
}

function mysqlDate(value: unknown) {
  if (value === null || value === undefined) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}
