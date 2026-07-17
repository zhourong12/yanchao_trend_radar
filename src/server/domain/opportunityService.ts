import type {
  CollectionDashboard,
  CollectionRecord,
  FeedbackAction,
  ManualOpportunityInput,
  ManualOpportunityRecord,
  OpportunityAnalysis,
  OpportunityEvidence,
  OpportunityStatus,
  ProductOpportunity,
  SourceStatus,
  TrendSignal
} from "../../shared/types";
import { seedSupplyAdapter, seedTrendAdapter } from "../adapters/seedAdapters";
import { getGoogleValidationCollectionRecords, getWeiboCollectionRecords } from "../adapters/liveAdapters";
import {
  discoverGoogleTrendingCandidates,
  getCachedGoogleTrendingCandidates,
  invalidateGoogleTrendingCache
} from "../adapters/googleTrendingAdapter";
import { getHotListCollectionRecords } from "../adapters/hotListAdapters";
import {
  fetchAlibaba1688Supply,
  getAlibaba1688AuthorizationStatus,
  getAlibaba1688CollectionState
} from "../adapters/alibaba1688Adapter";
import { fetchConfiguredSales, fetchConfiguredSupply, getConfiguredSalesState } from "../adapters/liveBusinessAdapters";
import { getTaobaoAuthorizationStatus, getTaobaoThemeCollectionRecords } from "../adapters/taobaoGlobalAdapter";
import { getRegisteredTrendSource, listRegisteredTrendSources } from "../adapters/sourceRegistry";
import { calculateEvidenceCompleteness, calculateOpportunityScores } from "./scoring";
import {
  appendFeedback,
  appendManualOpportunity,
  getFeedback,
  getValidation,
  listManualOpportunities
} from "./stateStore";
import {
  collectionTimeZone,
  currentCollectionDate,
  mergeAndReadCollectionRecords,
  readCollectionRecords
} from "./collectionLedger";
import { persistSourceStatuses, readSourceStatuses } from "./sourceConnectionRepository";
import { beginCollectionRun, completeCollectionRun, failCollectionRun } from "./collectionRunRepository";
import { persistOpportunitySnapshots, readOpportunitySnapshots } from "./opportunityRepository";

let signalCache: { expiresAt: number; signals: TrendSignal[] } | null = null;
let signalDiscovery: Promise<TrendSignal[]> | null = null;
let sourceStatuses: SourceStatus[] = [];
let collectionRun: Promise<{ dashboard: CollectionDashboard; opportunityCount: number }> | null = null;

const demandByCategory: Record<string, string> = {
  "small-appliance": "人体降温和通勤降温",
  pet: "宠物高温防护",
  auto: "车内降温和遮阳",
  outdoor: "雨季通勤防护"
};

const eventByMarket: Record<string, { eventName: string; timeWindow: string }> = {
  EU: { eventName: "欧洲高温", timeWindow: "2-4 周" },
  DE: { eventName: "德国趋势", timeWindow: "2-4 周" },
  SEA: { eventName: "东南亚雨季", timeWindow: "3-6 周" },
  CN: { eventName: "中国实时热搜", timeWindow: "1-2 周" }
};

const actionsByCategory: Record<string, string[]> = {
  "small-appliance": ["筛选低噪音卖点", "确认电池和 CE/RoHS 合规", "48 小时内找 3 家供应商打样"],
  pet: ["确认材质安全证明", "补充大中小尺寸组合", "采样海外差评痛点做卖点优化"],
  auto: ["优先选择通用尺寸", "验证安装方式和退货风险", "测试组合装价格带"],
  outdoor: ["验证防滑和耐用性", "选低 MOQ 供应商试单", "按雨季地区做关键词投放"]
};

function groupSignals(signals: TrendSignal[]) {
  return signals.reduce<Record<string, TrendSignal[]>>((groups, signal) => {
    const key = `${signal.keyword}::${signal.market}`;
    groups[key] = groups[key] ?? [];
    groups[key].push(signal);
    return groups;
  }, {});
}

function buildMarketTrends(keyword: string, signals: TrendSignal[]): ProductOpportunity["marketTrends"] {
  const matching = signals.filter((signal) => signal.keyword === keyword && signal.origin === "live");
  const markets = new Map<string, TrendSignal[]>();
  for (const signal of matching) {
    markets.set(signal.market, [...(markets.get(signal.market) ?? []), signal]);
  }
  return [...markets.entries()]
    .map(([market, marketSignals]) => ({
      market,
      value: Math.round(Math.max(...marketSignals.map((signal) => signal.currentIndex))),
      sourceCount: new Set(marketSignals.map((signal) => signal.sourcePlatform ?? signal.source)).size,
      observedAt:
        marketSignals
          .map((signal) => signal.observedAt)
          .sort()
          .at(-1) ?? new Date(0).toISOString(),
      origin: "live" as const
    }))
    .sort((a, b) => b.value - a.value);
}

function statusFromFeedback(actions: FeedbackAction[] | undefined): OpportunityStatus {
  const lastAction = actions?.at(-1)?.action;
  if (lastAction === "follow_up") return "follow_up";
  if (lastAction === "verifying") return "verifying";
  if (lastAction === "sampling") return "sampling";
  if (lastAction === "listed") return "listed";
  if (lastAction === "rejected" || lastAction === "not_useful") return "rejected";
  if (lastAction === "useful") return "watching";
  return "new";
}

export async function listOpportunities(): Promise<ProductOpportunity[]> {
  return readOpportunitySnapshots();
}

export async function refreshOpportunitySnapshots(): Promise<ProductOpportunity[]> {
  const signals = await discoverSignals();
  const groups = groupSignals(signals);
  const discoveredOpportunities = await Promise.all(
    Object.entries(groups).map(([groupKey, groupedSignals]) => {
      const [keyword] = groupKey.split("::");
      const primarySignal = groupedSignals[0];
      return buildOpportunity(groupedSignals, {
        id: `${primarySignal.market.toLowerCase()}-${keyword.replace(/\s+/g, "-")}`,
        keyword,
        marketTrends: groupedSignals.some((signal) => signal.origin === "live")
          ? buildMarketTrends(keyword, signals)
          : []
      });
    })
  );
  const manualOpportunities = await Promise.all(
    (await listManualOpportunities()).map((record) =>
      buildOpportunity([manualSignal(record)], {
        id: record.id,
        keyword: record.productName,
        eventName: record.eventName,
        demand: record.demand,
        timeWindow: record.timeWindow,
        nextAction: record.nextAction,
        updatedAt: record.updatedAt
      })
    )
  );
  const opportunities = [...discoveredOpportunities, ...manualOpportunities];

  const sorted = opportunities.sort((a, b) => b.scores.overall - a.scores.overall);
  await persistOpportunitySnapshots(sorted, { pruneDiscovered: true });
  return sorted;
}

interface OpportunityBuildOptions {
  id: string;
  keyword: string;
  eventName?: string;
  demand?: string;
  timeWindow?: string;
  nextAction?: string;
  updatedAt?: string;
  marketTrends?: ProductOpportunity["marketTrends"];
}

async function buildOpportunity(groupedSignals: TrendSignal[], options: OpportunityBuildOptions) {
  const cappedSignals = capSignals(groupedSignals);
  const primarySignal = cappedSignals[0];
  const supply = await resolveSupply(options.keyword, primarySignal.market);
  const sales = await resolveSales(options.keyword, primarySignal.market);
  const feedback = await getFeedback(options.id);
  const scores = calculateOpportunityScores(cappedSignals, supply, sales, feedback);
  const validation = await getValidation(options.id);
  const latestMetadata = [...feedback].reverse().find((item) => item.owner || item.dueDate);
  const evidence = buildOpportunityEvidence(cappedSignals, supply, sales, validation);
  const baseAnalysis = buildOpportunityAnalysis(primarySignal, supply, sales, evidence);
  const analysis = options.nextAction ? { ...baseAnalysis, nextBestAction: options.nextAction } : baseAnalysis;

  return {
    id: options.id,
    eventName:
      options.eventName ?? eventByMarket[primarySignal.market]?.eventName ?? `${primarySignal.market} 趋势事件`,
    market: primarySignal.market,
    category: primarySignal.category,
    demand: options.demand ?? demandByCategory[primarySignal.category] ?? "区域性需求变化",
    productName: supply.productName,
    reason: analysis.signal,
    timeWindow: options.timeWindow ?? eventByMarket[primarySignal.market]?.timeWindow ?? "2-4 周",
    trendSignals: cappedSignals,
    marketTrends: options.marketTrends ?? [],
    supply,
    sales,
    evidenceLinks: buildEvidenceLinks(options.keyword, primarySignal),
    validation,
    scores,
    evidence,
    analysis,
    suggestedActions: actionsByCategory[primarySignal.category] ?? ["人工复核趋势来源", "验证供给和毛利"],
    status: statusFromFeedback(feedback),
    feedbackHistory: feedback.slice(-5).reverse(),
    owner: latestMetadata?.owner,
    dueDate: latestMetadata?.dueDate,
    updatedAt: options.updatedAt ?? new Date().toISOString()
  } satisfies ProductOpportunity;
}

function manualSignal(record: ManualOpportunityRecord): TrendSignal {
  return {
    id: `${record.id}-signal`,
    source: "Manual opportunity",
    origin: "seed",
    sourceKind: "seed",
    sourceRisk: "low",
    retrievedAt: record.createdAt,
    methodology: "Operator-created opportunity hypothesis awaiting external evidence validation.",
    platformType: "trend",
    keyword: record.productName,
    market: record.market,
    category: record.category,
    observedAt: record.createdAt,
    currentIndex: 0,
    baselineIndex: 0,
    growthRate: 0,
    confidence: 0.35,
    evidence: record.reason,
    sourcePlatform: "manual"
  };
}

export async function createManualOpportunity(input: ManualOpportunityInput) {
  const record = await appendManualOpportunity(input);
  const opportunity = await buildOpportunity([manualSignal(record)], {
    id: record.id,
    keyword: record.productName,
    eventName: record.eventName,
    demand: record.demand,
    timeWindow: record.timeWindow,
    nextAction: record.nextAction,
    updatedAt: record.updatedAt
  });
  await persistOpportunitySnapshots([opportunity]);
  return opportunity;
}

export async function listSignals() {
  return signalCache?.signals ?? [];
}

export async function listTrendCandidates() {
  return getCachedGoogleTrendingCandidates();
}

export async function getSourceHealth() {
  const persisted = await readSourceStatuses();
  if (persisted.length > 0) sourceStatuses = persisted;
  return sourceStatuses;
}

const collectionChannelDefinitions = [
  {
    id: "google-trends-discovery",
    label: "Google 热点发现",
    description: "按国家采集 Trending Now 原始搜索热点，无需预设关键词。",
    purpose: "discovery" as const
  },
  {
    id: "google-trends-validation",
    label: "Google 关键词验证",
    description: "对已识别或人工配置的监控词进行 90 天趋势验证。",
    purpose: "discovery" as const
  },
  {
    id: "weibo-hot-live",
    label: "微博热搜",
    description: "采集微博实时榜单并识别商品消费场景。",
    purpose: "discovery" as const
  },
  {
    id: "daily-hot-api",
    label: "DailyHot API",
    description: "采集本地聚合的微博、抖音、知乎等榜单。",
    purpose: "discovery" as const
  },
  {
    id: "60s-hot-api",
    label: "60 秒 API",
    description: "采集第三方多平台热榜，作为交叉信号。",
    purpose: "discovery" as const
  },
  {
    id: "taobao-theme-discovery",
    label: "淘宝官方主题",
    description: "复用代购项目的 Global Open 签名链路，采集区域热销与优选主题。",
    purpose: "discovery" as const
  },
  {
    id: "1688-supply-live",
    label: "1688 实时供给",
    description: "通过 1688 Global Open 搜索真实商品、价格、月销与供给样本。",
    purpose: "validation" as const
  },
  {
    id: "amazon-sales",
    label: "Amazon 销售",
    description: "通过授权销售数据接口验证真实价格、竞品、评论痛点和需求代理。",
    purpose: "validation" as const
  },
  {
    id: "seed-trend-adapter",
    label: "Seed 回退",
    description: "仅在真实信号不足时使用的演示数据，不计为真实采集。",
    purpose: "demo" as const
  }
];

export async function getTodayCollectionDashboard(): Promise<CollectionDashboard> {
  const persisted = await readSourceStatuses();
  if (persisted.length > 0) sourceStatuses = persisted;
  return buildCollectionDashboard(await readCollectionRecords(), new Date().toISOString());
}

async function collectTodayCollectionDashboard(runId?: string): Promise<CollectionDashboard> {
  const signals = await discoverSignals();
  const alibaba1688State = getAlibaba1688CollectionState();
  const collectedAt = new Date().toISOString();
  const candidates = process.env.DISABLE_LIVE_SOURCES === "true" ? [] : await discoverGoogleTrendingCandidates();
  const googleRecords: CollectionRecord[] = candidates.map((candidate) => ({
    id: candidate.id,
    channel: "google-trends-discovery",
    platform: "google-trending",
    market: candidate.market,
    title: candidate.query,
    collectedAt,
    observedAt: candidate.observedAt,
    metricLabel: "搜索量级",
    metricValue: candidate.approximateTraffic,
    sourceUrl: candidate.sourceUrl,
    outcome: candidate.matchedKeyword ? "mapped" : "filtered",
    enteredAnalysis: Boolean(candidate.matchedKeyword),
    mappedKeyword: candidate.matchedKeyword,
    category: candidate.category,
    mappingConfidence: candidate.mappingConfidence,
    reason: candidate.matchedKeyword
      ? "命中商品场景规则，已进入机会分析。"
      : "当前热点未识别出明确商品意图，保留用于后续规则迭代。",
    origin: "live"
  }));
  const liveCollectionRecords =
    process.env.DISABLE_LIVE_SOURCES === "true"
      ? []
      : [
          ...googleRecords,
          ...getGoogleValidationCollectionRecords(),
          ...getWeiboCollectionRecords(),
          ...getHotListCollectionRecords("daily-hot-api"),
          ...getHotListCollectionRecords("60s-hot-api"),
          ...getTaobaoThemeCollectionRecords(),
          ...alibaba1688State.records
        ];
  const seedRecords: CollectionRecord[] = signals
    .filter((signal) => signal.origin === "seed")
    .map((signal) => ({
      id: signal.id,
      channel: "seed-trend-adapter",
      platform: signal.sourcePlatform ?? "seed",
      market: signal.market,
      title: signal.sourceTopic ?? signal.keyword,
      collectedAt,
      observedAt: signal.observedAt,
      metricLabel: "演示指数",
      metricValue: signal.currentIndex,
      sourceUrl: signal.sourceUrl,
      outcome: "demo",
      enteredAnalysis: false,
      mappedKeyword: signal.keyword,
      category: signal.category,
      mappingConfidence: signal.mappingConfidence ?? signal.confidence,
      reason: "Seed 演示数据，仅用于流程回退，不代表今日真实平台采集。",
      origin: "seed"
    }));
  const date = currentCollectionDate();
  const records = await mergeAndReadCollectionRecords([...liveCollectionRecords, ...seedRecords], date, runId);
  const dashboard = buildCollectionDashboard(records, collectedAt);
  await persistSourceStatuses(
    dashboard.channels.map((channel) => ({
      name: channel.id,
      ok: channel.ok,
      signalCount: channel.rawCount,
      lastCheckedAt: channel.lastCheckedAt ?? collectedAt,
      riskLevel: channel.riskLevel ?? "medium",
      error: channel.error
    }))
  );
  return dashboard;
}

function buildCollectionDashboard(records: CollectionRecord[], generatedAt: string): CollectionDashboard {
  const alibaba1688State = getAlibaba1688CollectionState();
  const configuredSalesState = getConfiguredSalesState();
  const channels = collectionChannelDefinitions.map((definition) => {
    const status = sourceStatuses.find((source) => source.name === definition.id);
    const businessStatus = definition.id === "1688-supply-live" ? alibaba1688State : undefined;
    const salesStatus = definition.id === "amazon-sales" ? configuredSalesState : undefined;
    const channelRecords = records.filter((record) => record.channel === definition.id);
    const lastCheckedAt = status?.lastCheckedAt ?? businessStatus?.lastCheckedAt ?? salesStatus?.lastCheckedAt;
    const freshness = sourceFreshness(lastCheckedAt);
    return {
      ...definition,
      ok: status?.ok ?? businessStatus?.ok ?? salesStatus?.ok ?? false,
      rawCount: channelRecords.length,
      mappedCount: channelRecords.filter((record) => record.outcome === "mapped" && record.origin === "live").length,
      validationCount: channelRecords.filter((record) => record.outcome === "validation").length,
      demoCount: channelRecords.filter((record) => record.outcome === "demo").length,
      filteredCount: channelRecords.filter((record) => record.outcome === "filtered").length,
      lastCheckedAt,
      ...freshness,
      riskLevel: status?.riskLevel ?? (businessStatus?.configured ? ("low" as const) : salesStatus?.riskLevel),
      error: status?.error ?? businessStatus?.error ?? salesStatus?.error
    };
  });
  return {
    date: currentCollectionDate(),
    generatedAt,
    timeZone: collectionTimeZone,
    totalCollected: records.length,
    mappedCount: records.filter((record) => record.outcome === "mapped" && record.origin === "live").length,
    validationCount: records.filter((record) => record.outcome === "validation").length,
    demoCount: records.filter((record) => record.outcome === "demo").length,
    filteredCount: records.filter((record) => record.outcome === "filtered").length,
    liveCount: records.filter((record) => record.origin === "live").length,
    records,
    channels
  };
}

function sourceFreshness(lastCheckedAt?: string) {
  if (!lastCheckedAt) return { freshnessStatus: "never" as const };
  const age = Date.now() - Date.parse(lastCheckedAt);
  const freshnessMinutes = Math.max(0, Math.floor(age / 60_000));
  const staleAfterMinutes = Number(process.env.COLLECTION_STALE_AFTER_MINUTES ?? 180);
  return {
    freshnessStatus: freshnessMinutes > staleAfterMinutes ? ("stale" as const) : ("fresh" as const),
    freshnessMinutes
  };
}

export async function getAnalysisDigest() {
  const opportunities = await listOpportunities();
  const blockers = [...new Set(opportunities.flatMap((opportunity) => opportunity.evidence.blockers))].slice(0, 8);
  return {
    generatedAt: new Date().toISOString(),
    totalOpportunities: opportunities.length,
    actionableCount: opportunities.filter((opportunity) => opportunity.evidence.stage === "actionable").length,
    validatingCount: opportunities.filter((opportunity) => opportunity.evidence.stage === "validating").length,
    hypothesisCount: opportunities.filter((opportunity) => opportunity.evidence.stage === "hypothesis").length,
    demoCount: opportunities.filter((opportunity) => opportunity.evidence.dataQuality === "demo").length,
    blockers,
    sourceHealth: sourceStatuses,
    topOpportunities: opportunities.slice(0, 5)
  };
}

export function runCollectionNow(trigger: "scheduled" | "manual" | "test" = "manual") {
  if (collectionRun) return collectionRun;
  signalCache = null;
  sourceStatuses = [];
  invalidateGoogleTrendingCache();
  collectionRun = (async () => {
    const runId = await beginCollectionRun(trigger);
    try {
      const opportunities = await refreshOpportunitySnapshots();
      const dashboard = await collectTodayCollectionDashboard(runId);
      await completeCollectionRun(runId, {
        rawCount: dashboard.totalCollected,
        mappedCount: dashboard.mappedCount,
        errorCount: dashboard.channels.filter((channel) => !channel.ok).length,
        summary: { opportunityCount: opportunities.length }
      });
      return { dashboard, opportunityCount: opportunities.length };
    } catch (error) {
      await failCollectionRun(runId, error);
      throw error;
    }
  })().finally(() => {
    collectionRun = null;
  });
  return collectionRun;
}

export async function testCollectionSource(sourceId: string) {
  const definition = collectionChannelDefinitions.find((channel) => channel.id === sourceId);
  if (!definition) return null;

  const checkedAt = new Date().toISOString();
  let rawCount = 0;
  let mappedCount = 0;
  let riskLevel: "low" | "medium" | "high" = "medium";
  let error: string | undefined;

  try {
    const adapter = getRegisteredTrendSource(sourceId);
    if (adapter) {
      if (sourceId === "taobao-theme-discovery") {
        const authorization = await getTaobaoAuthorizationStatus();
        if (!authorization.authorized) {
          throw new Error(
            authorization.configured ? "淘宝应用已配置，但账号授权已失效，请重新授权" : "淘宝 AppKey/AppSecret 尚未配置"
          );
        }
      }
      const signals = await adapter.discoverSignals();
      rawCount = sourceId === "taobao-theme-discovery" ? getTaobaoThemeCollectionRecords().length : signals.length;
      mappedCount = signals.length;
      riskLevel = adapter.riskLevel;
    } else if (sourceId === "1688-supply-live") {
      const authorization = await getAlibaba1688AuthorizationStatus();
      if (!authorization.authorized) {
        throw new Error(
          authorization.configured ? "1688 应用已配置，但账号授权已失效，请重新授权" : "1688 AppKey/AppSecret 尚未配置"
        );
      }
      const supply = await fetchAlibaba1688Supply(process.env.SOURCE_TEST_KEYWORD ?? "portable fan", "US");
      if (!supply) throw new Error("1688 未返回可用的实时供给数据");
      const state = getAlibaba1688CollectionState();
      rawCount = state.records.length;
      mappedCount = 0;
      riskLevel = "low";
    } else if (sourceId === "amazon-sales") {
      const sales = await fetchConfiguredSales(process.env.SOURCE_TEST_KEYWORD ?? "portable fan", "US");
      if (!sales) throw new Error("Amazon 销售数据接口尚未配置");
      rawCount = 1;
      mappedCount = 0;
      riskLevel = sales.sourceRisk;
    } else if (sourceId === "seed-trend-adapter") {
      const signals = await seedTrendAdapter.discoverSignals();
      rawCount = signals.length;
      mappedCount = 0;
      riskLevel = seedTrendAdapter.riskLevel;
    } else {
      throw new Error("该数据源暂不支持独立连接测试");
    }
  } catch (sourceError) {
    error = sourceError instanceof Error ? sourceError.message : String(sourceError);
  }

  const result = {
    ...definition,
    ok: !error,
    rawCount,
    mappedCount,
    validationCount: definition.purpose === "validation" ? rawCount : 0,
    demoCount: definition.purpose === "demo" ? rawCount : 0,
    filteredCount: definition.purpose === "discovery" ? Math.max(0, rawCount - mappedCount) : 0,
    lastCheckedAt: checkedAt,
    riskLevel,
    error
  };
  const nextStatus = {
    name: sourceId,
    ok: result.ok,
    signalCount: rawCount,
    lastCheckedAt: checkedAt,
    riskLevel,
    error
  };
  sourceStatuses = [...sourceStatuses.filter((status) => status.name !== sourceId), nextStatus];
  await persistSourceStatuses([nextStatus]);
  return result;
}

export async function searchSupply(keyword: string, market: string) {
  return resolveSupply(keyword, market);
}

export async function recordFeedback(action: FeedbackAction) {
  const result = await appendFeedback(action);
  const feedback = await getFeedback(action.opportunityId);
  const snapshots = await readOpportunitySnapshots();
  const current = snapshots.find((opportunity) => opportunity.id === action.opportunityId);
  if (current) {
    const latestMetadata = [...feedback].reverse().find((item) => item.owner || item.dueDate);
    const latestBusinessOutcome = [...feedback].reverse().find((item) => item.outcome)?.outcome;
    const scores = calculateOpportunityScores(current.trendSignals, current.supply, current.sales, feedback);
    await persistOpportunitySnapshots([
      {
        ...current,
        status: statusFromFeedback(feedback),
        validation: result.validation,
        scores,
        feedbackHistory: feedback.slice(-5).reverse(),
        businessOutcome: latestBusinessOutcome,
        owner: latestMetadata?.owner,
        dueDate: latestMetadata?.dueDate,
        updatedAt: result.record.createdAt
      }
    ]);
  }
  return {
    opportunityId: action.opportunityId,
    status: statusFromFeedback(feedback),
    feedbackCount: result.feedbackCount,
    validation: result.validation
  };
}

export async function opportunityExists(opportunityId: string) {
  return (await listOpportunities()).some((opportunity) => opportunity.id === opportunityId);
}

async function discoverSignals() {
  if (signalCache && signalCache.expiresAt > Date.now()) {
    return signalCache.signals;
  }
  if (signalDiscovery) return signalDiscovery;

  signalDiscovery = executeSignalDiscovery().finally(() => {
    signalDiscovery = null;
  });
  return signalDiscovery;
}

async function executeSignalDiscovery() {
  const liveAdapters = listRegisteredTrendSources();
  const checkedAt = new Date().toISOString();
  const liveResults =
    process.env.DISABLE_LIVE_SOURCES === "true"
      ? liveAdapters.map(() => ({ status: "fulfilled", value: [] }) as PromiseFulfilledResult<TrendSignal[]>)
      : await Promise.allSettled(liveAdapters.map((adapter) => adapter.discoverSignals()));
  sourceStatuses = liveResults.map((result, index) => {
    const adapter = liveAdapters[index];
    if (result.status === "fulfilled") {
      return {
        name: adapter.name,
        ok: true,
        signalCount: result.value.length,
        lastCheckedAt: checkedAt,
        riskLevel: adapter.riskLevel
      };
    }
    const error = result.reason instanceof Error ? result.reason.message : String(result.reason);
    console.error(JSON.stringify({ event: "source_fetch_failed", source: adapter.name, error }));
    return {
      name: adapter.name,
      ok: false,
      signalCount: 0,
      lastCheckedAt: checkedAt,
      riskLevel: adapter.riskLevel,
      error
    };
  });
  const liveSignals = dedupeLiveSignals(
    liveResults.flatMap((result) => (result.status === "fulfilled" ? result.value : []))
  );
  const seedSignals = await seedTrendAdapter.discoverSignals();
  sourceStatuses.push({
    name: seedTrendAdapter.name,
    ok: true,
    signalCount: seedSignals.length,
    lastCheckedAt: checkedAt,
    riskLevel: seedTrendAdapter.riskLevel
  });
  await persistSourceStatuses(sourceStatuses);
  const signals = liveSignals.length > 0 ? mergeSignals(liveSignals, seedSignals) : seedSignals;

  signalCache = {
    expiresAt: Date.now() + 10 * 60 * 1000,
    signals
  };
  return signals;
}

function mergeSignals(liveSignals: TrendSignal[], seedSignals: TrendSignal[]) {
  const liveKeys = new Set(liveSignals.map((signal) => `${signal.keyword}:${signal.market}`));
  const fallbackSignals = seedSignals.filter((signal) => !liveKeys.has(`${signal.keyword}:${signal.market}`));
  return [...liveSignals, ...fallbackSignals];
}

function dedupeLiveSignals(signals: TrendSignal[]) {
  const seen = new Set<string>();
  return signals.filter((signal) => {
    const platform = signal.sourcePlatform ?? signal.source;
    const topic = normalizeTopic(signal.sourceTopic ?? signal.evidence);
    const key = `${signal.keyword}:${signal.market}:${platform}:${topic}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function capSignals(signals: TrendSignal[]) {
  const perSource = new Map<string, number>();
  return [...signals]
    .sort((a, b) => b.currentIndex - a.currentIndex)
    .filter((signal) => {
      const source = signal.sourcePlatform ?? signal.source;
      const sourceCount = perSource.get(source) ?? 0;
      if (sourceCount >= 4) return false;
      perSource.set(source, sourceCount + 1);
      return true;
    })
    .slice(0, 12);
}

function normalizeTopic(topic: string) {
  return topic
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function buildEvidenceLinks(keyword: string, signal: TrendSignal) {
  const encoded = encodeURIComponent(keyword);
  const cnKeyword = encodeURIComponent(
    signal.category === "pet"
      ? "宠物 降温 垫"
      : signal.category === "auto"
        ? "车载 遮阳 帘"
        : signal.category === "outdoor"
          ? "防水 鞋套"
          : "便携 风扇"
  );
  return [
    {
      label: "1688 供给搜索",
      url: `https://s.1688.com/selloffer/offer_search.htm?keywords=${cnKeyword}`,
      kind: "supply_search" as const
    },
    {
      label: "淘宝价格带搜索",
      url: `https://s.taobao.com/search?q=${cnKeyword}`,
      kind: "supply_search" as const
    },
    {
      label: "Amazon 竞品搜索",
      url: `https://www.amazon.com/s?k=${encoded}`,
      kind: "sales_search" as const
    },
    {
      label: signal.origin === "seed" ? "Seed 演示证据（待外部验证）" : `${signal.source} 证据`,
      url:
        signal.sourceUrl ??
        (signal.origin === "seed"
          ? `https://www.google.com/search?q=${encoded}`
          : signal.source.includes("Weibo")
            ? `https://s.weibo.com/weibo?q=${encodeURIComponent(signal.keyword)}`
            : `https://trends.google.com/trends/explore?q=${encoded}`),
      kind: "trend_source" as const
    }
  ];
}

async function resolveSupply(keyword: string, market: string) {
  if (process.env.DISABLE_LIVE_SOURCES !== "true") {
    try {
      const live = await fetchConfiguredSupply(keyword, market);
      if (live) return live;
      const alibaba1688 = await fetchAlibaba1688Supply(keyword, market);
      if (alibaba1688) return alibaba1688;
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "supply_source_failed",
          keyword,
          market,
          error: error instanceof Error ? error.message : String(error)
        })
      );
    }
  }
  return { ...(await seedSupplyAdapter.fetchSupply(keyword)), isFallback: true };
}

async function resolveSales(keyword: string, market: string) {
  if (process.env.DISABLE_LIVE_SOURCES !== "true") {
    try {
      const live = await fetchConfiguredSales(keyword, market);
      if (live) return live;
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "sales_source_failed",
          keyword,
          market,
          error: error instanceof Error ? error.message : String(error)
        })
      );
    }
  }
  return {
    platform: "销售数据待验证",
    origin: "seed" as const,
    sourceKind: "seed" as const,
    sourceRisk: "high" as const,
    competitorCount: 0,
    targetPriceUsd: 0,
    reviewPainPoints: [],
    demandProxy: 0,
    isFallback: true
  };
}

function buildOpportunityEvidence(
  signals: TrendSignal[],
  supply: ProductOpportunity["supply"],
  sales: ProductOpportunity["sales"],
  validation: ProductOpportunity["validation"]
): OpportunityEvidence {
  const liveTrendSources = signals.filter((signal) => signal.origin === "live").length;
  const seedTrendSources = signals.filter((signal) => signal.origin === "seed").length;
  const liveSignals = signals.filter((signal) => signal.origin === "live");
  const uniqueTrendPlatforms = [...new Set(liveSignals.map((signal) => signal.sourcePlatform ?? signal.source))];
  const supplyVerified = supply.origin === "live" && supply.sourceKind !== "seed" && !supply.isFallback;
  const salesVerified = sales.origin === "live" && sales.sourceKind !== "seed" && !sales.isFallback;
  const completeness = calculateEvidenceCompleteness(signals, supply, sales);
  const blockers: string[] = [];
  if (!supplyVerified) blockers.push("供给尚未接入真实数据源");
  if (!salesVerified) blockers.push("销售尚未接入真实数据源");
  if (seedTrendSources > 0) blockers.push("趋势包含 seed 回退数据");
  if (uniqueTrendPlatforms.length < 2) blockers.push("趋势证据只有单一来源");
  if (validation.supply !== "verified") blockers.push("供给验证尚未完成");
  if (validation.sales !== "verified") blockers.push("销售验证尚未完成");
  const fullyVerified =
    liveTrendSources > 0 &&
    seedTrendSources === 0 &&
    supplyVerified &&
    salesVerified &&
    validation.supply === "verified" &&
    validation.sales === "verified";
  const stage = fullyVerified
    ? "actionable"
    : liveTrendSources > 0 && (supplyVerified || salesVerified || completeness >= 60)
      ? "validating"
      : liveTrendSources > 0
        ? "hypothesis"
        : "signal";
  const dataQuality =
    supplyVerified && salesVerified && seedTrendSources === 0 ? "verified" : liveTrendSources > 0 ? "mixed" : "demo";
  return {
    dataQuality,
    stage,
    liveTrendSources,
    seedTrendSources,
    uniqueTrendPlatforms,
    supplyVerified,
    salesVerified,
    completeness,
    blockers
  };
}

function buildOpportunityAnalysis(
  signal: TrendSignal,
  supply: ProductOpportunity["supply"],
  sales: ProductOpportunity["sales"],
  evidence: OpportunityEvidence
): OpportunityAnalysis {
  const signalText = `${signal.evidence} 当前汇总 ${evidence.liveTrendSources} 条实时趋势、${evidence.seedTrendSources} 条 seed 趋势，覆盖 ${evidence.uniqueTrendPlatforms.length} 个来源。`;
  const hypothesis = `${supply.productName} 与“${signal.category}”需求相匹配；供给${evidence.supplyVerified ? "已接入实时数据" : "目前只有 Demo 代理"}，销售${evidence.salesVerified ? "已接入实时数据" : "目前只有 Demo 代理"}。`;
  const decision =
    evidence.stage === "actionable"
      ? "证据达到可执行门槛，可进入采购、打样或上架决策。"
      : evidence.stage === "validating"
        ? "可以进入人工验证，但暂不应按最终商业机会承诺。"
        : "当前只能作为趋势假设，不能直接进入采购或上架。";
  const nextBestAction = evidence.blockers[0] ?? `验证 ${sales.platform} 的真实价格、竞品和用户痛点。`;
  return { signal: signalText, hypothesis, decision, blockers: evidence.blockers, nextBestAction };
}
