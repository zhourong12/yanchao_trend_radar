import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { runCollectionNow } from "./domain/opportunityService";

const testDirectory = mkdtempSync(join(tmpdir(), "opportunity-radar-"));
process.env.OPPORTUNITY_STATE_PATH = join(testDirectory, "state.json");
process.env.COLLECTION_LEDGER_PATH = join(testDirectory, "collection-ledger.json");
process.env.DISABLE_LIVE_SOURCES = "true";

beforeAll(async () => {
  await runCollectionNow("test");
});

afterAll(() => {
  delete process.env.OPPORTUNITY_STATE_PATH;
  delete process.env.COLLECTION_LEDGER_PATH;
  delete process.env.DISABLE_LIVE_SOURCES;
  rmSync(testDirectory, { recursive: true, force: true });
});

describe("opportunity API", () => {
  const app = createApp();

  it("returns health status", async () => {
    const response = await request(app).get("/api/health").expect(200);

    expect(response.body).toMatchObject({ ok: true, service: "yanchao-opportunity-radar", degraded: false });
    expect(response.body.sources.length).toBeGreaterThan(0);
  });

  it("returns scored opportunities", async () => {
    const response = await request(app).get("/api/opportunities").expect(200);

    expect(response.body.data.length).toBeGreaterThan(0);
    expect(response.body.data[0].scores.overall).toBeGreaterThan(0);
  });

  it("creates and persists a manual opportunity hypothesis", async () => {
    const createResponse = await request(app)
      .post("/api/opportunities/manual")
      .send({
        productName: "折叠露营灯",
        market: "US",
        category: "outdoor",
        eventName: "露营季",
        demand: "户外照明",
        reason: "运营人员发现站内搜索和供应商询价同步增长",
        nextAction: "验证美国站真实销量与价格带"
      })
      .expect(201);

    expect(createResponse.body.data.id).toMatch(/^manual-/);
    expect(createResponse.body.data.productName).toBe("折叠露营灯");
    expect(createResponse.body.data.evidence.stage).toBe("signal");

    const listResponse = await request(app).get("/api/opportunities?market=US&status=all").expect(200);
    expect(listResponse.body.data.some((item: { id: string }) => item.id === createResponse.body.data.id)).toBe(true);
  });

  it("filters opportunities by market", async () => {
    const response = await request(app).get("/api/opportunities?market=EU&status=all").expect(200);

    expect(response.body.data.every((item: { market: string }) => item.market === "EU")).toBe(true);
  });

  it("records feedback and updates status", async () => {
    const listResponse = await request(app).get("/api/opportunities").expect(200);
    const opportunityId = listResponse.body.data[0].id;
    const previousAdjustment = listResponse.body.data[0].scores.feedbackAdjustment;

    await request(app)
      .post("/api/feedback")
      .send({
        opportunityId,
        action: "sampling",
        owner: "测试负责人",
        dueDate: "2026-07-20",
        note: "样品通过",
        outcome: {
          observedAt: "2026-07-16T00:00:00.000Z",
          unitsSold: 80,
          revenueUsd: 1600,
          grossProfitUsd: 420,
          returnRate: 0.03
        }
      })
      .expect(200);
    const filteredResponse = await request(app).get("/api/opportunities?status=sampling").expect(200);

    expect(filteredResponse.body.data.some((item: { id: string }) => item.id === opportunityId)).toBe(true);
    const updated = filteredResponse.body.data.find((item: { id: string }) => item.id === opportunityId);
    expect(updated.owner).toBe("测试负责人");
    expect(updated.feedbackHistory[0].note).toBe("样品通过");
    expect(updated.businessOutcome).toMatchObject({ unitsSold: 80, grossProfitUsd: 420 });
    expect(updated.scores.feedbackAdjustment).toBeGreaterThan(previousAdjustment);
  });

  it("reports readiness", async () => {
    const response = await request(app).get("/api/ready").expect(200);
    expect(response.body.ready).toBe(true);
  });

  it("reports runtime and source metrics", async () => {
    const response = await request(app).get("/api/metrics").expect(200);
    expect(response.body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(response.body.memoryBytes.rss).toBeGreaterThan(0);
    expect(response.body.sourceSuccessCount).toBeGreaterThan(0);
  });

  it("returns a business analysis digest with evidence gates", async () => {
    const response = await request(app).get("/api/analysis").expect(200);
    expect(response.body.data.totalOpportunities).toBeGreaterThan(0);
    expect(response.body.data.topOpportunities[0].evidence).toBeDefined();
    expect(response.body.data.topOpportunities[0].analysis.nextBestAction).toBeTruthy();
  });

  it("returns the raw trend candidate pool", async () => {
    const response = await request(app).get("/api/trend-candidates").expect(200);
    expect(response.body.data).toEqual([]);
  });

  it("reports Taobao authorization status without exposing credentials", async () => {
    const response = await request(app).get("/api/integrations/taobao/status").expect(200);
    expect(response.body.data).toHaveProperty("configured");
    expect(response.body.data).toHaveProperty("requiresAuthorization");
    expect(JSON.stringify(response.body)).not.toContain("appSecret");
    expect(JSON.stringify(response.body)).not.toContain("accessToken");
  });

  it("returns today's channel-level collection ledger", async () => {
    const response = await request(app).get("/api/collections/today").expect(200);
    expect(response.body.data.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(response.body.data.channels.length).toBeGreaterThan(0);
    expect(response.body.data.records.some((item: { origin: string }) => item.origin === "seed")).toBe(true);
    expect(response.body.data.mappedCount).toBe(0);
    expect(response.body.data.demoCount).toBeGreaterThan(0);
  });

  it("runs collection through the main application process", async () => {
    const response = await request(app).post("/api/collections/run").expect(200);
    expect(response.body.data.dashboard.channels.length).toBeGreaterThan(0);
    expect(response.body.data.opportunityCount).toBeGreaterThan(0);
  });

  it("tests a configured source through the collection module", async () => {
    const response = await request(app).post("/api/sources/seed-trend-adapter/test").expect(200);
    expect(response.body.data).toMatchObject({ id: "seed-trend-adapter", ok: true });
  });

  it("searches supply and labels fallback data", async () => {
    const response = await request(app)
      .post("/api/supply/search")
      .send({ keyword: "portable fan", market: "CN" })
      .expect(200);
    expect(response.body.data.productName).toBeTruthy();
    expect(response.body.data.isFallback).toBe(true);
  });

  it("rejects feedback for unknown opportunities", async () => {
    await request(app).post("/api/feedback").send({ opportunityId: "missing", action: "sampling" }).expect(404);
  });

  it("rejects invalid opportunity query values", async () => {
    await request(app).get("/api/opportunities?market=bad&status=all").expect(400);
    await request(app).get("/api/opportunities?market=all&status=bad").expect(400);
  });

  it("rejects invalid feedback", async () => {
    await request(app).post("/api/feedback").send({ opportunityId: "", action: "bad" }).expect(400);
  });

  it("protects feedback writes with origin and token controls", async () => {
    await request(app)
      .post("/api/feedback")
      .set("Origin", "https://malicious.example")
      .send({ opportunityId: "missing", action: "sampling" })
      .expect(403);

    process.env.REQUIRE_FEEDBACK_TOKEN = "true";
    process.env.FEEDBACK_API_TOKEN = "test-secret";
    try {
      await request(app).post("/api/feedback").send({ opportunityId: "missing", action: "sampling" }).expect(401);
      await request(app)
        .post("/api/feedback")
        .set("Authorization", "Bearer test-secret")
        .send({ opportunityId: "missing", action: "sampling" })
        .expect(404);
    } finally {
      delete process.env.REQUIRE_FEEDBACK_TOKEN;
      delete process.env.FEEDBACK_API_TOKEN;
    }
  });

  it("protects collection and connection administration with an admin token", async () => {
    process.env.REQUIRE_ADMIN_TOKEN = "true";
    process.env.ADMIN_API_TOKEN = "admin-test-secret";
    try {
      await request(app).post("/api/sources/seed-trend-adapter/test").expect(401);
      const response = await request(app)
        .post("/api/sources/seed-trend-adapter/test")
        .set("Authorization", "Bearer admin-test-secret")
        .expect(200);
      expect(response.body.data).toMatchObject({ mappedCount: 0, demoCount: 4 });
    } finally {
      delete process.env.REQUIRE_ADMIN_TOKEN;
      delete process.env.ADMIN_API_TOKEN;
    }
  });
});
