import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CollectionRecord, FeedbackRecord, ManualOpportunityRecord, ValidationState } from "../src/shared/types";
import { mergeAndReadCollectionRecords } from "../src/server/domain/collectionLedger";
import { writeIntegrationCredential } from "../src/server/infrastructure/integrationCredentialStore";
import { initializeMysqlStore, mysqlPool } from "../src/server/infrastructure/mysqlStore";

interface LegacyState {
  feedback?: FeedbackRecord[];
  validation?: Record<string, ValidationState>;
  manualOpportunities?: ManualOpportunityRecord[];
}

interface LegacyLedger {
  records?: Array<CollectionRecord & { collectionDate?: string }>;
}

await initializeMysqlStore();
const state = readJson<LegacyState>(process.env.OPPORTUNITY_STATE_PATH ?? "./data/opportunity-state.json") ?? {};
const ledger = readJson<LegacyLedger>(process.env.COLLECTION_LEDGER_PATH ?? "./data/collection-ledger.json") ?? {};

for (const record of state.manualOpportunities ?? []) {
  await mysqlPool().query(
    `INSERT IGNORE INTO opportunities
     (id, origin, product_name, market, category, event_name, demand, reason, time_window, next_action, created_at, updated_at)
     VALUES (?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.id,
      record.productName,
      record.market,
      record.category,
      record.eventName,
      record.demand,
      record.reason,
      record.timeWindow ?? null,
      record.nextAction ?? null,
      new Date(record.createdAt),
      new Date(record.updatedAt)
    ]
  );
}

for (const record of state.feedback ?? []) {
  const [existing] = await mysqlPool().query(
    "SELECT id FROM opportunity_feedback WHERE opportunity_id = ? AND action = ? AND created_at = ? LIMIT 1",
    [record.opportunityId, record.action, safeDate(record.createdAt)]
  );
  if (Array.isArray(existing) && existing.length > 0) continue;
  await mysqlPool().query(
    `INSERT INTO opportunity_feedback
     (opportunity_id, action, note, owner, due_date, evidence_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      record.opportunityId,
      record.action,
      record.note ?? null,
      record.owner ?? null,
      record.dueDate ?? null,
      record.evidenceUrl ?? null,
      safeDate(record.createdAt)
    ]
  );
}

for (const [opportunityId, validation] of Object.entries(state.validation ?? {})) {
  await mysqlPool().query(
    `INSERT INTO opportunity_validations
     (opportunity_id, supply_status, sales_status, last_note, last_evidence_url, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE supply_status = VALUES(supply_status), sales_status = VALUES(sales_status),
       last_note = VALUES(last_note), last_evidence_url = VALUES(last_evidence_url), updated_at = VALUES(updated_at)`,
    [
      opportunityId,
      validation.supply,
      validation.sales,
      validation.lastNote ?? null,
      validation.lastEvidenceUrl ?? null,
      validation.updatedAt ? new Date(validation.updatedAt) : new Date()
    ]
  );
}

const collectionRecords = (ledger.records ?? []).map((legacyRecord) => {
  const record = { ...legacyRecord };
  delete record.collectionDate;
  return record;
});
if (collectionRecords.length > 0) await mergeAndReadCollectionRecords(collectionRecords);

await migrateAuthorization(
  "taobao",
  process.env.TAOBAO_GLOBAL_OPEN_APPKEY,
  process.env.TAOBAO_AUTH_STATE_PATH ?? "./data/taobao-global-auth.json"
);
await migrateAuthorization(
  "1688",
  process.env.ALIBABA_1688_APPKEY,
  process.env.ALIBABA_1688_AUTH_STATE_PATH ?? "./data/alibaba-1688-auth.json"
);

console.log(
  JSON.stringify({
    migrated: true,
    feedback: state.feedback?.length ?? 0,
    validations: Object.keys(state.validation ?? {}).length,
    manualOpportunities: state.manualOpportunities?.length ?? 0,
    collectionRecords: collectionRecords.length
  })
);
await mysqlPool().end();

async function migrateAuthorization(provider: string, appKey: string | undefined, path: string) {
  const authorization = readJson<unknown>(path);
  if (appKey && authorization) await writeIntegrationCredential(provider, appKey, authorization);
}

function readJson<T>(path: string): T | null {
  const absolutePath = resolve(path);
  return existsSync(absolutePath) ? (JSON.parse(readFileSync(absolutePath, "utf8")) as T) : null;
}

function safeDate(value: string | undefined) {
  const date = value ? new Date(value) : new Date(0);
  return Number.isFinite(date.getTime()) ? date : new Date(0);
}
