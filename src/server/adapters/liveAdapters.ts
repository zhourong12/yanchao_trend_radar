import googleTrends from "google-trends-api";
import { z } from "zod";
import type { CollectionRecord, TrendSignal } from "../../shared/types";
import type { TrendSourceAdapter } from "./types";
import { fetchAdapterJson } from "./adapterHttp";
import { mapHotTopicToProduct } from "./hotListAdapters";

const weiboPayloadSchema = z.object({
  code: z.number().optional(),
  data: z
    .array(
      z.object({
        title: z.string(),
        hot: z.string().optional(),
        index: z.number().optional(),
        url: z.string().url().optional()
      })
    )
    .optional()
});

const googleTimelineSchema = z.object({
  default: z
    .object({
      timelineData: z
        .array(
          z.object({
            time: z.string(),
            value: z.array(z.number())
          })
        )
        .optional()
    })
    .optional()
});

const defaultGoogleGeos = ["AU", "GB", "CN", "US", "IT", "ES", "CA", "FR", "HK", "DE"];
const LIVE_TIMEOUT_MS = 5_000;
let latestWeiboCollectionRecords: CollectionRecord[] = [];
let latestGoogleValidationRecords: CollectionRecord[] = [];

const categoryByKeyword: Record<string, string> = {
  "portable fan": "small-appliance",
  "pet cooling mat": "pet",
  "car sun shade": "auto",
  "waterproof shoe cover": "outdoor"
};

function parseHotScore(hot?: string) {
  if (!hot) return 0;
  const numeric = Number(hot.replace(/[^\d.]/g, ""));
  if (Number.isNaN(numeric)) return 0;
  if (hot.includes("万")) return numeric * 10_000;
  return numeric;
}

function scoreToIndex(score: number, rank?: number) {
  const scoreIndex = Math.min(95, Math.round(Math.log10(Math.max(score, 1)) * 13));
  const rankBoost = rank ? Math.max(0, 30 - rank) : 0;
  return Math.min(100, scoreIndex + rankBoost);
}

export const mapWeiboTitleToProduct = mapHotTopicToProduct;

export function parseGoogleTimeline(raw: string, keyword: string, geo: string): TrendSignal | null {
  if (Buffer.byteLength(raw, "utf8") > 2_000_000) throw new Error("Google Trends response exceeded 2 MB");
  const payload = googleTimelineSchema.parse(JSON.parse(raw) as unknown);
  const timeline = payload.default?.timelineData ?? [];
  if (timeline.length === 0) return null;
  const values = timeline.map((point) => point.value[0] ?? 0);
  const currentIndex = values.at(-1) ?? 0;
  const baselineValues = values.slice(0, Math.max(1, values.length - 7));
  const baselineIndex = Math.max(
    1,
    Math.round(baselineValues.reduce((sum, value) => sum + value, 0) / baselineValues.length)
  );

  return {
    id: `google-live-${geo.toLowerCase()}-${keyword.replace(/\s+/g, "-")}`,
    source: "Google Trends keyword validation",
    origin: "live",
    sourceKind: "unofficial",
    sourceRisk: "medium",
    retrievedAt: new Date().toISOString(),
    methodology: `Non-official google-trends-api interestOverTime query, 90-day window, geo=${geo}; market is labelled ${geo}.`,
    platformType: "trend",
    keyword,
    market: geo,
    category: categoryByKeyword[keyword] ?? "general",
    observedAt: new Date().toISOString(),
    currentIndex,
    baselineIndex,
    growthRate: (currentIndex - baselineIndex) / baselineIndex,
    confidence: 0.72,
    evidence: `Live Google Trends interest over time for "${keyword}" in ${geo}.`,
    sourceUrl: `https://trends.google.com/trends/explore?geo=${encodeURIComponent(geo)}&q=${encodeURIComponent(keyword)}`
  };
}

function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = LIVE_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export const googleTrendsLiveAdapter: TrendSourceAdapter = {
  name: "google-trends-validation",
  type: "trend",
  riskLevel: "medium",
  async discoverSignals() {
    latestGoogleValidationRecords = [];
    const startTime = new Date();
    startTime.setDate(startTime.getDate() - 90);
    const results = await Promise.allSettled(
      configuredGoogleTrendTargets().map(async ({ keyword, geo }) => {
        const raw = await withTimeout(
          googleTrends.interestOverTime({ keyword, startTime, geo }),
          `Google Trends ${keyword} ${geo}`
        );
        return { signal: parseGoogleTimeline(raw, keyword, geo), keyword, geo };
      })
    );
    const completed = results
      .filter(
        (result): result is PromiseFulfilledResult<{ signal: TrendSignal | null; keyword: string; geo: string }> =>
          result.status === "fulfilled"
      )
      .map((result) => result.value);
    latestGoogleValidationRecords = completed.map(({ signal, keyword, geo }) => ({
      id: `google-validation-${geo.toLowerCase()}-${keyword.replace(/\s+/g, "-")}`,
      channel: "google-trends-validation",
      platform: "google-trends",
      market: geo,
      title: keyword,
      collectedAt: signal?.retrievedAt ?? new Date().toISOString(),
      observedAt: signal?.observedAt,
      metricLabel: "趋势指数",
      metricValue: signal?.currentIndex ?? 0,
      sourceUrl: `https://trends.google.com/trends/explore?geo=${encodeURIComponent(geo)}&q=${encodeURIComponent(keyword)}`,
      outcome: "validation",
      enteredAnalysis: Boolean(signal),
      mappedKeyword: signal?.keyword,
      category: signal?.category,
      mappingConfidence: signal?.confidence,
      reason: signal ? "监控词验证完成，已更新趋势强度。" : "接口未返回可用时间序列。",
      origin: "live"
    }));
    return completed.map((item) => item.signal).filter((signal): signal is TrendSignal => Boolean(signal));
  }
};

function configuredProductKeywords() {
  const configured =
    (process.env.TREND_WATCHLIST_KEYWORDS ?? process.env.TREND_KEYWORDS)
      ?.split(",")
      .map((keyword) => keyword.trim())
      .filter(Boolean) ?? [];
  return [...new Set(configured)];
}

export function configuredGoogleGeos() {
  const configuredGeos =
    process.env.GOOGLE_TRENDS_GEOS?.split(",")
      .map((geo) => geo.trim().toUpperCase())
      .filter(Boolean) ?? [];
  return configuredGeos.length > 0 ? [...new Set(configuredGeos)] : defaultGoogleGeos;
}

export function configuredGoogleTrendTargets() {
  return configuredGoogleGeos().flatMap((geo) => configuredProductKeywords().map((keyword) => ({ keyword, geo })));
}

export const weiboHotLiveAdapter: TrendSourceAdapter = {
  name: "weibo-hot-live",
  type: "content",
  riskLevel: "medium",
  async discoverSignals() {
    latestWeiboCollectionRecords = [];
    const payload = weiboPayloadSchema.parse(
      await fetchAdapterJson("https://v2.xxapi.cn/api/weibohot", {
        label: "Weibo hot API",
        timeoutMs: LIVE_TIMEOUT_MS,
        maximumBytes: 1_000_000,
        init: { headers: { "User-Agent": "yanchao-opportunity-radar/0.1" } }
      })
    );
    const items = payload.data ?? [];
    const collectedAt = new Date().toISOString();
    const signals: Array<TrendSignal | null> = items.map((item) => {
      const mapped = mapWeiboTitleToProduct(item.title);
      if (!mapped) return null;
      const currentIndex = scoreToIndex(parseHotScore(item.hot), item.index);
      return {
        id: `weibo-live-${item.index ?? item.title}`,
        source: "Weibo Hot third-party live",
        origin: "live",
        sourceKind: "third_party",
        sourceRisk: "medium",
        retrievedAt: new Date().toISOString(),
        methodology: "Third-party non-official Weibo hot topic API mapped to product keywords by rule.",
        platformType: "content",
        keyword: mapped.keyword,
        market: mapped.market,
        category: mapped.category,
        observedAt: new Date().toISOString(),
        currentIndex,
        baselineIndex: Math.max(10, Math.round(currentIndex * 0.55)),
        growthRate: 0.8,
        confidence: 0.62,
        evidence: `Live Weibo hot topic "${item.title}" mapped to ${mapped.demand}.`
      } satisfies TrendSignal;
    });

    latestWeiboCollectionRecords = items.map((item, index) => {
      const signal = signals[index];
      const heat = parseHotScore(item.hot);
      return {
        id: `weibo-hot-${hashTitle(item.title)}`,
        channel: "weibo-hot-live",
        platform: "weibo",
        market: "CN",
        title: item.title,
        collectedAt,
        observedAt: collectedAt,
        metricLabel: heat > 0 ? "热度" : "榜单排名",
        metricValue: heat > 0 ? heat : item.index,
        rank: item.index,
        sourceUrl: item.url,
        outcome: signal ? "mapped" : "filtered",
        enteredAnalysis: Boolean(signal),
        mappedKeyword: signal?.keyword,
        category: signal?.category,
        mappingConfidence: signal?.mappingConfidence ?? signal?.confidence,
        reason: signal ? "命中商品场景规则，已进入机会分析。" : "未命中商品意图规则，保留在采集台账中。",
        origin: "live"
      } satisfies CollectionRecord;
    });

    return signals.filter((signal): signal is TrendSignal => Boolean(signal)).slice(0, 12);
  }
};

export function getWeiboCollectionRecords() {
  return latestWeiboCollectionRecords;
}

export function getGoogleValidationCollectionRecords() {
  return latestGoogleValidationRecords;
}

function hashTitle(title: string) {
  let hash = 0;
  for (let index = 0; index < title.length; index += 1) hash = (hash * 31 + title.charCodeAt(index)) >>> 0;
  return hash.toString(36);
}
