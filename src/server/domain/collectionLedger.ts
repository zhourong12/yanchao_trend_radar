import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { CollectionRecord } from "../../shared/types";
import { initializeMysqlStore, isMysqlConfigured, mysqlPool } from "../infrastructure/mysqlStore";

const collectionRecordSchema = z.object({
  id: z.string().min(1),
  channel: z.string().min(1),
  platform: z.string().min(1),
  market: z.string().optional(),
  title: z.string().min(1),
  collectedAt: z.string().datetime(),
  observedAt: z.string().datetime().optional(),
  metricLabel: z.string().optional(),
  metricValue: z.number().finite().optional(),
  rank: z.number().finite().optional(),
  sourceUrl: z.string().optional(),
  outcome: z.enum(["mapped", "filtered", "validation", "demo"]),
  enteredAnalysis: z.boolean(),
  mappedKeyword: z.string().optional(),
  category: z.string().optional(),
  mappingConfidence: z.number().finite().optional(),
  reason: z.string(),
  origin: z.enum(["live", "seed"]),
  collectionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

const ledgerSchema = z.object({
  version: z.literal(1),
  records: z.array(collectionRecordSchema)
});
const publicCollectionRecordSchema = collectionRecordSchema.omit({ collectionDate: true });

type LedgerRecord = CollectionRecord & { collectionDate: string };
interface CollectionLedgerState {
  version: 1;
  records: LedgerRecord[];
}

export const collectionTimeZone = process.env.COLLECTION_TIME_ZONE ?? "Asia/Singapore";

export function currentCollectionDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: collectionTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export async function mergeAndReadCollectionRecords(
  records: CollectionRecord[],
  date = currentCollectionDate(),
  runId?: string
) {
  if (isMysqlConfigured()) {
    if (!runId) throw new Error("A collection run id is required for persisted collection records");
    return mergeAndReadMysqlRecords(records, date, runId);
  }
  const merge = (state: CollectionLedgerState) => {
    const validated = ledgerSchema.parse(state);
    const keyed = new Map(validated.records.map((record) => [ledgerKey(record), record]));
    records.forEach((record) => {
      const entry: LedgerRecord = { ...record, collectionDate: currentCollectionDate(new Date(record.collectedAt)) };
      keyed.set(ledgerKey(entry), entry);
    });
    const cutoff = currentCollectionDate(new Date(Date.now() - 14 * 24 * 60 * 60 * 1000));
    return { version: 1 as const, records: [...keyed.values()].filter((record) => record.collectionDate >= cutoff) };
  };
  const next = merge(readLedger());
  writeLedger(next);
  return next.records
    .filter((record) => record.collectionDate === date)
    .map((record) => publicCollectionRecordSchema.parse(record))
    .sort((a, b) => b.collectedAt.localeCompare(a.collectedAt));
}

export async function readCollectionRecords(date = currentCollectionDate()): Promise<CollectionRecord[]> {
  if (!isMysqlConfigured()) {
    return readLedger()
      .records.filter((record) => record.collectionDate === date)
      .map((record) => publicCollectionRecordSchema.parse(record))
      .sort((a, b) => b.collectedAt.localeCompare(a.collectedAt));
  }
  await initializeMysqlStore();
  const [rows] = await mysqlPool().query<RowDataPacket[]>(
    `SELECT records.* FROM collection_records records
     WHERE records.collection_date = ?
       AND records.run_id = (
         SELECT latest.run_id
         FROM collection_records latest
         INNER JOIN collection_runs runs ON runs.id = latest.run_id
         WHERE latest.collection_date = ? AND runs.status IN ('succeeded', 'partial')
         ORDER BY runs.started_at DESC
         LIMIT 1
       )
     ORDER BY records.collected_at DESC`,
    [date, date]
  );
  return rows.map(collectionRecordFromRow);
}

export async function repairCollectionOutcomeSemantics() {
  if (!isMysqlConfigured()) return { updatedRows: 0 };
  await initializeMysqlStore();
  const [result] = await mysqlPool().query<ResultSetHeader>(
    "UPDATE collection_records SET entered_analysis = 0 WHERE outcome IN ('validation', 'demo') AND entered_analysis <> 0"
  );
  return { updatedRows: Number(result.affectedRows ?? 0) };
}

async function mergeAndReadMysqlRecords(records: CollectionRecord[], date: string, runId?: string) {
  await initializeMysqlStore();
  const connection = await mysqlPool().getConnection();
  try {
    await connection.beginTransaction();
    for (const record of records) {
      const collectionDate = currentCollectionDate(new Date(record.collectedAt));
      await connection.query(
        `INSERT INTO collection_records
         (run_id, collection_date, channel, external_id, platform, market, title, collected_at, observed_at,
          metric_label, metric_value, rank_value, source_url, outcome, entered_analysis, mapped_keyword,
          category, mapping_confidence, reason, origin)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE run_id = COALESCE(VALUES(run_id), run_id), platform = VALUES(platform), market = VALUES(market), title = VALUES(title),
          collected_at = VALUES(collected_at), observed_at = VALUES(observed_at), metric_label = VALUES(metric_label),
          metric_value = VALUES(metric_value), rank_value = VALUES(rank_value), source_url = VALUES(source_url),
          outcome = VALUES(outcome), entered_analysis = VALUES(entered_analysis), mapped_keyword = VALUES(mapped_keyword),
          category = VALUES(category), mapping_confidence = VALUES(mapping_confidence), reason = VALUES(reason), origin = VALUES(origin)`,
        [
          runId ?? null,
          collectionDate,
          record.channel,
          record.id,
          record.platform,
          record.market ?? null,
          record.title,
          new Date(record.collectedAt),
          record.observedAt ? new Date(record.observedAt) : null,
          record.metricLabel ?? null,
          record.metricValue ?? null,
          record.rank ?? null,
          record.sourceUrl ?? null,
          record.outcome,
          record.enteredAnalysis,
          record.mappedKeyword ?? null,
          record.category ?? null,
          record.mappingConfidence ?? null,
          record.reason,
          record.origin
        ]
      );
    }
    const cutoff = currentCollectionDate(new Date(Date.now() - 14 * 24 * 60 * 60 * 1000));
    await connection.query("DELETE FROM collection_records WHERE collection_date < ?", [cutoff]);
    const [rows] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM collection_records WHERE collection_date = ? AND run_id = ? ORDER BY collected_at DESC",
      [date, runId]
    );
    await connection.commit();
    return rows.map(collectionRecordFromRow);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function collectionRecordFromRow(row: RowDataPacket): CollectionRecord {
  return publicCollectionRecordSchema.parse({
    id: row.external_id,
    channel: row.channel,
    platform: row.platform,
    market: row.market ?? undefined,
    title: row.title,
    collectedAt: mysqlDate(row.collected_at),
    observedAt: mysqlDate(row.observed_at),
    metricLabel: row.metric_label ?? undefined,
    metricValue: row.metric_value === null ? undefined : Number(row.metric_value),
    rank: row.rank_value ?? undefined,
    sourceUrl: row.source_url ?? undefined,
    outcome: row.outcome,
    enteredAnalysis: Boolean(row.entered_analysis),
    mappedKeyword: row.mapped_keyword ?? undefined,
    category: row.category ?? undefined,
    mappingConfidence: row.mapping_confidence === null ? undefined : Number(row.mapping_confidence),
    reason: row.reason,
    origin: row.origin
  });
}

function mysqlDate(value: unknown) {
  if (value === null || value === undefined) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function ledgerPath() {
  return process.env.COLLECTION_LEDGER_PATH
    ? resolve(process.env.COLLECTION_LEDGER_PATH)
    : join(process.cwd(), "data", "collection-ledger.json");
}

function ledgerKey(record: LedgerRecord) {
  return `${record.collectionDate}:${record.channel}:${record.id}`;
}

function defaultLedger(): CollectionLedgerState {
  return { version: 1, records: [] };
}

function readLedger(): CollectionLedgerState {
  const path = ledgerPath();
  if (!existsSync(path)) return defaultLedger();
  try {
    return ledgerSchema.parse(JSON.parse(readFileSync(path, "utf8")) as unknown);
  } catch (error) {
    const corruptPath = `${path}.corrupt-${Date.now()}`;
    copyFileSync(path, corruptPath);
    console.error(
      JSON.stringify({
        event: "collection_ledger_reset_after_corruption",
        path,
        corruptPath,
        error: error instanceof Error ? error.message : String(error)
      })
    );
    return defaultLedger();
  }
}

function writeLedger(state: CollectionLedgerState) {
  const path = ledgerPath();
  const validated = ledgerSchema.parse(state);
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(validated, null, 2), "utf8");
  renameSync(temporaryPath, path);
}
