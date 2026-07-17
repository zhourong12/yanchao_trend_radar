import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { RowDataPacket } from "mysql2/promise";
import type {
  FeedbackAction,
  FeedbackRecord,
  ManualOpportunityInput,
  ManualOpportunityRecord,
  ValidationState
} from "../../shared/types";
import { checkMysqlStore, initializeMysqlStore, isMysqlConfigured, mysqlPool } from "../infrastructure/mysqlStore";

const feedbackRecordSchema = z.object({
  opportunityId: z.string().min(1),
  action: z.enum(["useful", "not_useful", "follow_up", "verifying", "sampling", "listed", "rejected"]),
  note: z.string().max(500).optional(),
  owner: z.string().max(80).optional(),
  dueDate: z.string().optional(),
  evidenceUrl: z.string().url().optional(),
  outcome: z
    .object({
      observedAt: z.string().datetime(),
      unitsSold: z.number().int().nonnegative().optional(),
      revenueUsd: z.number().nonnegative().optional(),
      grossProfitUsd: z.number().optional(),
      returnRate: z.number().min(0).max(1).optional()
    })
    .optional(),
  createdAt: z.string().datetime()
});

const validationSchema = z.object({
  supply: z.enum(["pending", "in_progress", "verified", "blocked"]),
  sales: z.enum(["pending", "in_progress", "verified", "blocked"]),
  lastNote: z.string().max(500).optional(),
  lastEvidenceUrl: z.string().url().optional(),
  updatedAt: z.string().datetime().optional()
});

const manualOpportunitySchema = z.object({
  id: z.string().min(1),
  productName: z.string().min(1).max(120),
  market: z.string().regex(/^[A-Z]{2,3}$/),
  category: z.string().min(1).max(80),
  eventName: z.string().min(1).max(120),
  demand: z.string().min(1).max(200),
  reason: z.string().min(1).max(500),
  timeWindow: z.string().max(80).optional(),
  nextAction: z.string().max(300).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

const stateSchema = z.object({
  feedback: z.array(feedbackRecordSchema),
  validation: z.record(z.string(), validationSchema),
  manualOpportunities: z.array(manualOpportunitySchema).default([])
});

interface OpportunityState {
  feedback: FeedbackRecord[];
  validation: Record<string, ValidationState>;
  manualOpportunities: ManualOpportunityRecord[];
}

function statePath() {
  return process.env.OPPORTUNITY_STATE_PATH
    ? resolve(process.env.OPPORTUNITY_STATE_PATH)
    : join(process.cwd(), "data", "opportunity-state.json");
}

function defaultState(): OpportunityState {
  return { feedback: [], validation: {}, manualOpportunities: [] };
}

function parseState(path: string): OpportunityState {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const migrated = migrateLegacyState(raw);
  return stateSchema.parse(migrated);
}

function readState(): OpportunityState {
  const path = statePath();
  if (!existsSync(path)) return defaultState();
  try {
    return parseState(path);
  } catch (error) {
    const backupPath = `${path}.bak`;
    if (existsSync(backupPath)) {
      try {
        const recovered = parseState(backupPath);
        console.error(JSON.stringify({ event: "state_recovered_from_backup", path, error: errorMessage(error) }));
        return recovered;
      } catch {
        // Fall through and preserve the corrupt primary for diagnosis.
      }
    }
    const corruptPath = `${path}.corrupt-${Date.now()}`;
    copyFileSync(path, corruptPath);
    console.error(
      JSON.stringify({ event: "state_reset_after_corruption", path, corruptPath, error: errorMessage(error) })
    );
    return defaultState();
  }
}

function writeState(state: OpportunityState) {
  const path = statePath();
  const validated = stateSchema.parse(state);
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) copyFileSync(path, `${path}.bak`);
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(validated, null, 2), "utf8");
  renameSync(temporaryPath, path);
}

export async function getFeedback(opportunityId: string): Promise<FeedbackRecord[]> {
  if (!isMysqlConfigured()) return readState().feedback.filter((item) => item.opportunityId === opportunityId);
  await initializeMysqlStore();
  const [rows] = await mysqlPool().query<RowDataPacket[]>(
    `SELECT opportunity_id, action, note, owner, due_date, evidence_url, outcome_json, created_at
     FROM opportunity_feedback WHERE opportunity_id = ? ORDER BY created_at`,
    [opportunityId]
  );
  return rows.map(feedbackFromRow);
}

export async function appendFeedback(action: FeedbackAction) {
  const record: FeedbackRecord = { ...action, createdAt: new Date().toISOString() };
  if (!isMysqlConfigured()) return appendFeedbackToFile(action, record);
  await initializeMysqlStore();
  const connection = await mysqlPool().getConnection();
  try {
    await connection.beginTransaction();
    const [validationRows] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM opportunity_validations WHERE opportunity_id = ? FOR UPDATE",
      [action.opportunityId]
    );
    const previousValidation = validationRows.length
      ? validationFromRow(validationRows[0])
      : ({ supply: "pending", sales: "pending" } satisfies ValidationState);
    const nextValidation = validationForAction(action, record.createdAt, previousValidation);
    await connection.query(
      `INSERT INTO opportunity_feedback
       (opportunity_id, action, note, owner, due_date, evidence_url, outcome_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?)`,
      [
        action.opportunityId,
        action.action,
        action.note ?? null,
        action.owner ?? null,
        action.dueDate ?? null,
        action.evidenceUrl ?? null,
        action.outcome ? JSON.stringify(action.outcome) : null,
        new Date(record.createdAt)
      ]
    );
    await connection.query(
      `INSERT INTO opportunity_validations
       (opportunity_id, supply_status, sales_status, last_note, last_evidence_url, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE supply_status = VALUES(supply_status), sales_status = VALUES(sales_status),
         last_note = VALUES(last_note), last_evidence_url = VALUES(last_evidence_url), updated_at = VALUES(updated_at)`,
      [
        action.opportunityId,
        nextValidation.supply,
        nextValidation.sales,
        nextValidation.lastNote ?? null,
        nextValidation.lastEvidenceUrl ?? null,
        new Date(record.createdAt)
      ]
    );
    const [counts] = await connection.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM opportunity_feedback WHERE opportunity_id = ?",
      [action.opportunityId]
    );
    await connection.commit();
    return {
      opportunityId: action.opportunityId,
      feedbackCount: Number(counts[0].count),
      validation: nextValidation,
      record
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function listManualOpportunities(): Promise<ManualOpportunityRecord[]> {
  if (!isMysqlConfigured()) return readState().manualOpportunities;
  await initializeMysqlStore();
  const [rows] = await mysqlPool().query<RowDataPacket[]>(
    "SELECT * FROM opportunities WHERE origin = 'manual' ORDER BY created_at"
  );
  return rows.map(manualOpportunityFromRow);
}

export async function appendManualOpportunity(input: ManualOpportunityInput) {
  const timestamp = new Date().toISOString();
  const record: ManualOpportunityRecord = {
    ...input,
    id: `manual-${randomUUID()}`,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  if (!isMysqlConfigured()) {
    const state = readState();
    writeState({ ...state, manualOpportunities: [...state.manualOpportunities, record] });
    return record;
  }
  await initializeMysqlStore();
  await mysqlPool().query(
    `INSERT INTO opportunities
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
  return record;
}

export async function getValidation(opportunityId: string): Promise<ValidationState> {
  if (!isMysqlConfigured()) return readState().validation[opportunityId] ?? { supply: "pending", sales: "pending" };
  await initializeMysqlStore();
  const [rows] = await mysqlPool().query<RowDataPacket[]>(
    "SELECT * FROM opportunity_validations WHERE opportunity_id = ?",
    [opportunityId]
  );
  return rows.length ? validationFromRow(rows[0]) : { supply: "pending", sales: "pending" };
}

export async function checkStateStore() {
  if (isMysqlConfigured()) return checkMysqlStore();
  readState();
  return { ok: true, driver: "json" as const, path: statePath() };
}

function appendFeedbackToFile(action: FeedbackAction, record: FeedbackRecord) {
  const state = readState();
  const previousValidation = state.validation[action.opportunityId] ?? { supply: "pending", sales: "pending" };
  const nextValidation = validationForAction(action, record.createdAt, previousValidation);
  const nextFeedback = [...state.feedback, record];
  writeState({
    ...state,
    feedback: nextFeedback,
    validation: { ...state.validation, [action.opportunityId]: nextValidation }
  });
  return {
    opportunityId: action.opportunityId,
    feedbackCount: nextFeedback.filter((item) => item.opportunityId === action.opportunityId).length,
    validation: nextValidation,
    record
  };
}

function validationForAction(action: FeedbackAction, updatedAt: string, previous: ValidationState): ValidationState {
  const metadata = { lastNote: action.note, lastEvidenceUrl: action.evidenceUrl, updatedAt };
  if (action.action === "verifying") return { supply: "in_progress", sales: "in_progress", ...metadata };
  if (action.action === "sampling") return { supply: "verified", sales: "in_progress", ...metadata };
  if (action.action === "listed") return { supply: "verified", sales: "verified", ...metadata };
  if (action.action === "rejected" || action.action === "not_useful") {
    return { supply: "blocked", sales: "blocked", ...metadata };
  }
  return previous;
}

function feedbackFromRow(row: RowDataPacket): FeedbackRecord {
  return feedbackRecordSchema.parse({
    opportunityId: row.opportunity_id,
    action: row.action,
    note: row.note ?? undefined,
    owner: row.owner ?? undefined,
    dueDate: mysqlDate(row.due_date, true),
    evidenceUrl: row.evidence_url ?? undefined,
    outcome: parseJsonColumn(row.outcome_json),
    createdAt: mysqlDate(row.created_at)
  });
}

function validationFromRow(row: RowDataPacket): ValidationState {
  return validationSchema.parse({
    supply: row.supply_status,
    sales: row.sales_status,
    lastNote: row.last_note ?? undefined,
    lastEvidenceUrl: row.last_evidence_url ?? undefined,
    updatedAt: mysqlDate(row.updated_at)
  });
}

function manualOpportunityFromRow(row: RowDataPacket): ManualOpportunityRecord {
  return manualOpportunitySchema.parse({
    id: row.id,
    productName: row.product_name,
    market: row.market,
    category: row.category,
    eventName: row.event_name,
    demand: row.demand,
    reason: row.reason,
    timeWindow: row.time_window ?? undefined,
    nextAction: row.next_action ?? undefined,
    createdAt: mysqlDate(row.created_at),
    updatedAt: mysqlDate(row.updated_at)
  });
}

function mysqlDate(value: unknown, dateOnly = false) {
  if (value === null || value === undefined) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) return undefined;
  return dateOnly ? date.toISOString().slice(0, 10) : date.toISOString();
}

function parseJsonColumn(value: unknown) {
  if (!value) return undefined;
  return typeof value === "string" ? (JSON.parse(value) as unknown) : value;
}

function migrateLegacyState(raw: unknown) {
  if (!raw || typeof raw !== "object") return raw;
  const candidate = raw as { feedback?: unknown; validation?: unknown; manualOpportunities?: unknown };
  if (!Array.isArray(candidate.feedback)) return raw;
  return {
    ...candidate,
    manualOpportunities: Array.isArray(candidate.manualOpportunities) ? candidate.manualOpportunities : [],
    feedback: candidate.feedback.map((item) => {
      if (!item || typeof item !== "object" || "createdAt" in item) return item;
      return { ...item, createdAt: new Date(0).toISOString() };
    })
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
