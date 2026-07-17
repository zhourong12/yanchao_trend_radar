import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

const opportunity = {
  id: "eu-portable-fan",
  eventName: "欧洲高温",
  market: "EU",
  category: "small-appliance",
  demand: "人体降温和通勤降温",
  productName: "便携小风扇",
  reason: "Heat demand is rising.",
  timeWindow: "2-4 周",
  trendSignals: [],
  supply: {
    productName: "便携小风扇",
    origin: "seed",
    sourceKind: "seed",
    sourceRisk: "low",
    supplierCount: 462,
    minPriceCny: 12,
    maxPriceCny: 38,
    moq: 2,
    leadTimeDays: 3,
    complianceTags: ["battery", "CE"]
  },
  sales: {
    platform: "Amazon",
    origin: "seed",
    sourceKind: "seed",
    sourceRisk: "low",
    competitorCount: 1850,
    targetPriceUsd: 18.99,
    reviewPainPoints: ["battery life"],
    demandProxy: 83
  },
  evidenceLinks: [
    { label: "1688 供给搜索", url: "https://s.1688.com", kind: "supply_search" },
    { label: "Amazon 竞品搜索", url: "https://www.amazon.com", kind: "sales_search" }
  ],
  validation: {
    supply: "pending",
    sales: "pending"
  },
  scores: {
    trend: 86,
    supply: 91,
    monetization: 100,
    competition: 28,
    risk: 70,
    confidence: 88,
    feedbackAdjustment: 0,
    rawOverall: 82,
    evidenceCompleteness: 42,
    decisionReadiness: 42,
    overall: 82
  },
  evidence: {
    dataQuality: "demo",
    stage: "hypothesis",
    liveTrendSources: 0,
    seedTrendSources: 1,
    uniqueTrendPlatforms: ["Google Trends"],
    supplyVerified: false,
    salesVerified: false,
    completeness: 42,
    blockers: ["供给尚未接入真实数据源", "销售尚未接入真实数据源"]
  },
  analysis: {
    signal: "趋势信号",
    hypothesis: "当前只有 Demo 代理数据。",
    decision: "当前只能作为趋势假设。",
    blockers: ["供给尚未接入真实数据源"],
    nextBestAction: "接入真实供给数据"
  },
  suggestedActions: ["确认电池和 CE/RoHS 合规"],
  status: "new",
  feedbackHistory: [],
  updatedAt: "2026-07-09T08:00:00.000Z"
};

const collectionDashboard = {
  date: "2026-07-13",
  generatedAt: "2026-07-13T08:00:00.000Z",
  timeZone: "Asia/Singapore",
  totalCollected: 1,
  mappedCount: 0,
  validationCount: 0,
  demoCount: 1,
  filteredCount: 0,
  liveCount: 0,
  records: [
    {
      id: "seed-1",
      channel: "seed-trend-adapter",
      platform: "seed",
      market: "EU",
      title: "portable fan",
      collectedAt: "2026-07-13T08:00:00.000Z",
      outcome: "demo",
      enteredAnalysis: false,
      mappedKeyword: "portable fan",
      reason: "Seed 演示数据",
      origin: "seed"
    }
  ],
  channels: [
    {
      id: "seed-trend-adapter",
      label: "Seed 回退",
      description: "演示数据",
      purpose: "demo",
      ok: true,
      rawCount: 1,
      mappedCount: 0,
      validationCount: 0,
      demoCount: 1,
      filteredCount: 0,
      lastCheckedAt: "2026-07-13T08:00:00.000Z"
    }
  ]
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("App", () => {
  it("renders opportunity cards from the API", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [opportunity] }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ data: collectionDashboard }) })
    );

    render(<App />);

    await waitFor(() => expect(screen.getByText("便携小风扇")).toBeInTheDocument());
    expect(screen.getByText("机会总数")).toBeInTheDocument();
    expect(screen.getByText("确认电池和 CE/RoHS 合规")).toBeInTheDocument();
  });

  it("submits feedback and refreshes opportunities", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [opportunity] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: collectionDashboard }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { status: "sampling" } }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ ...opportunity, status: "sampling" }] })
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: collectionDashboard }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await waitFor(() => expect(screen.getByText("便携小风扇")).toBeInTheDocument());
    fireEvent.click(screen.getByText("打样"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/feedback", expect.any(Object));
  });

  it("shows feedback errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [opportunity] }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ data: collectionDashboard }) })
        .mockResolvedValueOnce({ ok: false })
    );

    render(<App />);
    await waitFor(() => expect(screen.getByText("便携小风扇")).toBeInTheDocument());
    fireEvent.click(screen.getByText("打样"));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("反馈提交失败"));
  });

  it("creates a persisted manual opportunity through the workbench", async () => {
    const manualOpportunity = {
      ...opportunity,
      id: "manual-1",
      productName: "折叠露营灯",
      market: "US",
      eventName: "北美露营季"
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [opportunity] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: collectionDashboard }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: manualOpportunity }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [opportunity, manualOpportunity] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: collectionDashboard }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await waitFor(() => expect(screen.getByText("便携小风扇")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "新建人工机会" }));
    fireEvent.change(screen.getByLabelText("商品名称"), { target: { value: "折叠露营灯" } });
    fireEvent.change(screen.getByLabelText("目标市场"), { target: { value: "US" } });
    fireEvent.change(screen.getByLabelText("事件名称"), { target: { value: "北美露营季" } });
    fireEvent.change(screen.getByLabelText("需求描述"), { target: { value: "户外照明" } });
    fireEvent.change(screen.getByLabelText("判断依据"), { target: { value: "搜索和询价同步增长" } });
    fireEvent.click(screen.getByRole("button", { name: "创建待验证机会" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/opportunities/manual",
      expect.objectContaining({ method: "POST" })
    );
    expect(await screen.findByRole("heading", { name: "折叠露营灯" })).toBeInTheDocument();
  });

  it("tests authorized Taobao and 1688 connections without starting a full collection", async () => {
    const sourceDashboard = {
      ...collectionDashboard,
      channels: [
        {
          id: "taobao-theme-discovery",
          label: "淘宝官方主题",
          description: "淘宝主题数据",
          purpose: "discovery",
          ok: true,
          rawCount: 0,
          mappedCount: 0,
          validationCount: 0,
          demoCount: 0,
          filteredCount: 0,
          lastCheckedAt: "2026-07-16T08:00:00.000Z",
          riskLevel: "low"
        },
        {
          id: "1688-supply-live",
          label: "1688 实时供给",
          description: "1688 商品供给",
          purpose: "validation",
          ok: true,
          rawCount: 20,
          mappedCount: 0,
          validationCount: 20,
          demoCount: 0,
          filteredCount: 0,
          lastCheckedAt: "2026-07-16T08:00:00.000Z",
          riskLevel: "low"
        }
      ]
    };
    const tested1688 = { ...sourceDashboard.channels[1], rawCount: 21 };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [opportunity] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: sourceDashboard }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            configured: true,
            authorized: true,
            source: "stored_oauth",
            refreshAvailable: true,
            requiresAuthorization: false
          }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            configured: true,
            authorized: true,
            source: "stored_oauth",
            refreshAvailable: true,
            requiresAuthorization: false,
            proxyConfigured: true
          }
        })
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: tested1688 }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await waitFor(() => expect(screen.getByText("便携小风扇")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "数据源" }));

    const taobaoCard = screen.getByText("淘宝官方主题").closest("article");
    const alibabaCard = screen.getByText("1688 实时供给").closest("article");
    expect(taobaoCard).not.toBeNull();
    expect(alibabaCard).not.toBeNull();
    await waitFor(() => expect(within(alibabaCard!).getByText("已授权，可自动刷新；代理已配置")).toBeInTheDocument());
    expect(within(taobaoCard!).getByRole("button", { name: "测试连接" })).toBeInTheDocument();
    expect(within(alibabaCard!).getByRole("button", { name: "重新授权" })).toBeInTheDocument();

    fireEvent.click(within(alibabaCard!).getByRole("button", { name: "测试连接" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/sources/1688-supply-live/test",
        expect.objectContaining({ method: "POST" })
      )
    );
    expect(fetchMock).not.toHaveBeenCalledWith("/api/collections/run", expect.anything());
  });
});
