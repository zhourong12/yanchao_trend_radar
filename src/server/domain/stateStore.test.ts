import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendFeedback,
  appendManualOpportunity,
  getFeedback,
  getValidation,
  listManualOpportunities
} from "./stateStore";

let directory: string;
let path: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "opportunity-state-"));
  path = join(directory, "state.json");
  process.env.OPPORTUNITY_STATE_PATH = path;
});

afterEach(() => {
  delete process.env.OPPORTUNITY_STATE_PATH;
  rmSync(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("state store", () => {
  it("persists feedback metadata and completes both validations when listed", async () => {
    await appendFeedback({
      opportunityId: "eu-portable-fan",
      action: "listed",
      owner: "张三",
      dueDate: "2026-07-20",
      note: "首批上架",
      evidenceUrl: "https://example.com/evidence",
      outcome: {
        observedAt: "2026-07-16T00:00:00.000Z",
        unitsSold: 120,
        revenueUsd: 2800,
        grossProfitUsd: 640,
        returnRate: 0.04
      }
    });

    expect((await getFeedback("eu-portable-fan"))[0]).toMatchObject({
      owner: "张三",
      note: "首批上架",
      outcome: { unitsSold: 120, grossProfitUsd: 640 }
    });
    expect(await getValidation("eu-portable-fan")).toMatchObject({ supply: "verified", sales: "verified" });
  });

  it("recovers from the last valid backup when the primary file is corrupt", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await appendFeedback({ opportunityId: "x", action: "follow_up" });
    await appendFeedback({ opportunityId: "x", action: "verifying" });
    writeFileSync(path, "{broken", "utf8");

    expect(await getFeedback("x")).toHaveLength(1);
    expect(console.error).toHaveBeenCalled();
  });

  it("persists manual opportunity hypotheses alongside workflow state", async () => {
    const record = await appendManualOpportunity({
      productName: "折叠露营灯",
      market: "US",
      category: "outdoor",
      eventName: "北美露营季",
      demand: "户外照明",
      reason: "搜索和询价同步增长"
    });

    expect(record.id).toMatch(/^manual-/);
    expect(await listManualOpportunities()).toEqual([record]);
  });
});
