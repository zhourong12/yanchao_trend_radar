import { runCollectionNow, testCollectionSource } from "./opportunityService";

const DEFAULT_RETRY_DELAY_MS = 5_000;
const DEFAULT_MAX_BACKOFF_MS = 30 * 60_000;
const DEFAULT_ALERT_THRESHOLD = 3;
interface SourceSchedule {
  sourceId: string;
  intervalMs: number;
  consecutiveFailures: number;
  timer: NodeJS.Timeout | null;
}

const schedules = new Map<string, SourceSchedule>();
let stopped = false;

export function startCollectionScheduler() {
  if (schedules.size > 0) return () => stopCollectionScheduler();
  const configured = configuredSourceSchedules();
  if (configured.length === 0) return () => stopCollectionScheduler();
  stopped = false;
  for (const item of configured) {
    const schedule: SourceSchedule = { ...item, consecutiveFailures: 0, timer: null };
    schedules.set(item.sourceId, schedule);
    scheduleNext(schedule, process.env.COLLECTION_RUN_ON_STARTUP === "true" ? 0 : schedule.intervalMs);
  }
  console.info(
    JSON.stringify({
      event: "collection_scheduler_started",
      sources: configured.map(({ sourceId, intervalMs }) => ({ sourceId, intervalMinutes: intervalMs / 60_000 }))
    })
  );
  return () => stopCollectionScheduler();
}

export function stopCollectionScheduler() {
  stopped = true;
  for (const schedule of schedules.values()) {
    if (schedule.timer) clearTimeout(schedule.timer);
  }
  schedules.clear();
}

export function getCollectionScheduleState() {
  return [...schedules.values()].map((schedule) => ({
    sourceId: schedule.sourceId,
    intervalMs: schedule.intervalMs,
    consecutiveFailures: schedule.consecutiveFailures
  }));
}

export async function runScheduledSource(
  sourceId: string,
  execute: (id: string) => Promise<{ ok: boolean } | null> = testCollectionSource
) {
  if (sourceId === "all") {
    await runScheduledCollection();
    return { ok: true };
  }
  const result = await execute(sourceId);
  if (!result) throw new Error(`Unknown collection source: ${sourceId}`);
  if (!result.ok) throw new Error(`Collection source failed: ${sourceId}`);
  return result;
}

export async function runScheduledCollection() {
  const retries = Math.min(5, Math.max(0, Math.floor(positiveNumber(process.env.COLLECTION_RETRY_COUNT) ?? 2)));
  const retryDelayMs = Math.min(
    60_000,
    Math.max(250, positiveNumber(process.env.COLLECTION_RETRY_DELAY_MS) ?? DEFAULT_RETRY_DELAY_MS)
  );
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (stopped) throw new Error("Collection scheduler stopped");
    try {
      return await runCollectionNow("scheduled");
    } catch (error) {
      lastError = error;
      console.error(
        JSON.stringify({
          event: "scheduled_collection_attempt_failed",
          attempt: attempt + 1,
          maxAttempts: retries + 1,
          error: errorMessage(error)
        })
      );
      if (attempt < retries) await delay(retryDelayMs * 2 ** attempt);
    }
  }
  await sendFailureAlert(lastError, "all", retries + 1);
  throw lastError;
}

export function calculateSourceBackoffMs(consecutiveFailures: number, baseMs: number, maximumMs: number) {
  return Math.min(maximumMs, baseMs * 2 ** Math.max(0, consecutiveFailures - 1));
}

export function configuredSourceSchedules() {
  const globalInterval = positiveNumber(process.env.COLLECTION_SCHEDULE_INTERVAL_MINUTES);
  const entries = (process.env.COLLECTION_SOURCE_INTERVALS_MINUTES ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.lastIndexOf(":");
      if (separator <= 0) return null;
      const sourceId = entry.slice(0, separator).trim();
      const intervalMinutes = positiveNumber(entry.slice(separator + 1).trim());
      return sourceId && intervalMinutes ? { sourceId, intervalMs: intervalMinutes * 60_000 } : null;
    })
    .filter((entry): entry is { sourceId: string; intervalMs: number } => Boolean(entry));
  if (globalInterval) entries.push({ sourceId: "all", intervalMs: globalInterval * 60_000 });
  return entries;
}

function scheduleNext(schedule: SourceSchedule, delayMs: number) {
  if (stopped) return;
  schedule.timer = setTimeout(() => void executeSourceSchedule(schedule), delayMs);
  schedule.timer.unref();
}

async function executeSourceSchedule(schedule: SourceSchedule) {
  try {
    await runScheduledSource(schedule.sourceId);
    schedule.consecutiveFailures = 0;
    scheduleNext(schedule, schedule.intervalMs);
  } catch (error) {
    schedule.consecutiveFailures += 1;
    const retryDelayMs = Math.max(250, positiveNumber(process.env.COLLECTION_RETRY_DELAY_MS) ?? DEFAULT_RETRY_DELAY_MS);
    const maximumMs = Math.max(
      retryDelayMs,
      positiveNumber(process.env.COLLECTION_MAX_BACKOFF_MS) ?? DEFAULT_MAX_BACKOFF_MS
    );
    const nextDelayMs = calculateSourceBackoffMs(schedule.consecutiveFailures, retryDelayMs, maximumMs);
    console.error(
      JSON.stringify({
        event: "scheduled_source_failed",
        source: schedule.sourceId,
        consecutiveFailures: schedule.consecutiveFailures,
        nextDelayMs,
        error: errorMessage(error)
      })
    );
    const alertThreshold = Math.max(
      1,
      Math.floor(positiveNumber(process.env.COLLECTION_ALERT_FAILURE_THRESHOLD) ?? DEFAULT_ALERT_THRESHOLD)
    );
    if (shouldSendFailureAlert(schedule.consecutiveFailures, alertThreshold)) {
      try {
        await sendFailureAlert(error, schedule.sourceId, schedule.consecutiveFailures);
      } catch (alertError) {
        console.error(
          JSON.stringify({
            event: "collection_failure_alert_failed",
            source: schedule.sourceId,
            error: errorMessage(alertError)
          })
        );
      }
    }
    scheduleNext(schedule, nextDelayMs);
  }
}

export function shouldSendFailureAlert(consecutiveFailures: number, threshold: number) {
  return consecutiveFailures === Math.max(1, Math.floor(threshold));
}

async function sendFailureAlert(error: unknown, source: string, consecutiveFailures: number) {
  const endpoint = process.env.COLLECTION_ALERT_WEBHOOK_URL;
  if (!endpoint) return;
  const url = new URL(endpoint);
  if (url.protocol !== "https:") throw new Error("Collection alert webhook must use HTTPS");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "collection_failed",
        service: "yanchao-opportunity-radar",
        source,
        consecutiveFailures,
        occurredAt: new Date().toISOString(),
        error: errorMessage(error)
      }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Collection alert webhook failed: ${response.status}`);
  } finally {
    clearTimeout(timeout);
  }
}

function positiveNumber(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
