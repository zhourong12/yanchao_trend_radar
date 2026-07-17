import { afterEach, describe, expect, it } from "vitest";
import {
  calculateSourceBackoffMs,
  configuredSourceSchedules,
  runScheduledSource,
  shouldSendFailureAlert,
  stopCollectionScheduler
} from "./collectionScheduler";

afterEach(() => {
  delete process.env.COLLECTION_SCHEDULE_INTERVAL_MINUTES;
  delete process.env.COLLECTION_SOURCE_INTERVALS_MINUTES;
  stopCollectionScheduler();
});

describe("collection scheduler", () => {
  it("parses independent source frequencies", () => {
    process.env.COLLECTION_SOURCE_INTERVALS_MINUTES = "weibo-hot-live:5,amazon-sales:30";
    expect(configuredSourceSchedules()).toEqual([
      { sourceId: "weibo-hot-live", intervalMs: 300_000 },
      { sourceId: "amazon-sales", intervalMs: 1_800_000 }
    ]);
  });

  it("preserves a global snapshot schedule alongside per-source frequencies", () => {
    process.env.COLLECTION_SCHEDULE_INTERVAL_MINUTES = "10";
    const schedules = configuredSourceSchedules();
    expect(schedules).toEqual([{ sourceId: "all", intervalMs: 600_000 }]);
  });

  it("uses bounded exponential backoff", () => {
    expect(calculateSourceBackoffMs(1, 1_000, 10_000)).toBe(1_000);
    expect(calculateSourceBackoffMs(2, 1_000, 10_000)).toBe(2_000);
    expect(calculateSourceBackoffMs(8, 1_000, 10_000)).toBe(10_000);
  });

  it("alerts once when the consecutive-failure threshold is reached", () => {
    expect(shouldSendFailureAlert(2, 3)).toBe(false);
    expect(shouldSendFailureAlert(3, 3)).toBe(true);
    expect(shouldSendFailureAlert(4, 3)).toBe(false);
  });

  it("treats missing and failed source results as scheduler failures", async () => {
    await expect(runScheduledSource("missing", async () => null)).rejects.toThrow("Unknown collection source");
    await expect(runScheduledSource("weibo", async () => ({ ok: false }))).rejects.toThrow("Collection source failed");
  });
});
