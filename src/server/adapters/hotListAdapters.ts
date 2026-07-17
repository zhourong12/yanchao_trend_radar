import type { CollectionRecord, TrendSignal } from "../../shared/types";
import { z } from "zod";
import type { TrendSourceAdapter } from "./types";
import { fetchAdapterText } from "./adapterHttp";

interface HotListItem {
  title?: unknown;
  word?: unknown;
  keyword?: unknown;
  hot?: unknown;
  hot_value?: unknown;
  score?: unknown;
  score_desc?: unknown;
  rank?: unknown;
  index?: unknown;
  url?: unknown;
  link?: unknown;
  mobileUrl?: unknown;
}

interface HotListPayload {
  code?: number;
  data?: HotListItem[];
}

const hotListItemSchema = z.object({
  title: z.unknown().optional(),
  word: z.unknown().optional(),
  keyword: z.unknown().optional(),
  hot: z.unknown().optional(),
  hot_value: z.unknown().optional(),
  score: z.unknown().optional(),
  score_desc: z.unknown().optional(),
  rank: z.unknown().optional(),
  index: z.unknown().optional(),
  url: z.unknown().optional(),
  link: z.unknown().optional(),
  mobileUrl: z.unknown().optional()
});
const hotListPayloadSchema = z.union([
  z.array(hotListItemSchema),
  z.object({ code: z.number().optional(), data: z.array(hotListItemSchema).optional() })
]);

interface ProductMapping {
  keyword: string;
  market: string;
  category: string;
  demand: string;
  confidence: number;
}

interface HotListSourceConfig {
  name: string;
  baseUrl?: string;
  transport: "http" | "embedded-daily-hot";
  routes: string[];
  source: string;
  methodology: string;
  riskLevel: "medium" | "high";
}

const HOT_LIST_TIMEOUT_MS = 5_000;
const latestCollectionRecords = new Map<string, CollectionRecord[]>();

const allowPublicHotList = process.env.ALLOW_PUBLIC_HOTLIST === "true";
const configuredDailyHotBaseUrl = process.env.DAILY_HOT_API_BASE_URL;
const configuredSixtySecondsBaseUrl = process.env.SIXTY_SECONDS_API_BASE_URL;
const sixtySecondsIsPublic = configuredSixtySecondsBaseUrl?.includes("60s.viki.moe") ?? allowPublicHotList;

const dailyHotConfig: HotListSourceConfig = {
  name: "daily-hot-api",
  baseUrl: configuredDailyHotBaseUrl ?? (allowPublicHotList ? "https://api-hot.imsyy.top" : undefined),
  transport: configuredDailyHotBaseUrl || allowPublicHotList ? "http" : "embedded-daily-hot",
  routes: ["weibo", "douyin", "zhihu", "baidu", "bilibili", "toutiao"],
  source: configuredDailyHotBaseUrl
    ? "DailyHotApi configured aggregator"
    : allowPublicHotList
      ? "DailyHotApi public aggregator"
      : "DailyHotApi embedded aggregator",
  methodology:
    "Open-source DailyHotApi hot-list route mapped to product keywords by conservative scenario rules; self-hosting is recommended for stability.",
  riskLevel: allowPublicHotList && !configuredDailyHotBaseUrl ? "high" : "medium"
};

const sixtySecondsConfig: HotListSourceConfig = {
  name: "60s-hot-api",
  baseUrl: configuredSixtySecondsBaseUrl ?? (allowPublicHotList ? "https://60s.viki.moe/v2" : undefined),
  transport: "http",
  routes: ["weibo", "douyin", "zhihu", "baidu/hot", "bili", "rednote", "toutiao"],
  source: sixtySecondsIsPublic ? "60s public hot API" : "60s self-hosted hot API",
  methodology:
    "Open-source 60s hot topic API mapped to product keywords by conservative scenario rules; public instance requires explicit opt-in.",
  riskLevel: sixtySecondsIsPublic ? "high" : "medium"
};

const outdoorWeatherPattern =
  /(\u53f0\u98ce|\u66b4\u96e8|\u6d2a\u6c34|\u6d2a\u707e|\u9632\u6c5b|\u79ef\u6c34|\u6dcc\u6c34|\u96e8\u5929|\u66b4\u6d9d|\u6551\u63f4|\u64a4\u79bb|\u8f6c\u79fb|\u6c34\u707e|typhoon|storm|rainstorm|heavy rain|flood|flooding|wet weather)/i;
const heatPattern =
  /(\u9ad8\u6e29|\u70ed\u6d6a|\u7a7a\u8c03|\u964d\u6e29|\u907f\u6691|\u9177\u6691|\u708e\u70ed|\u9632\u6691|\u51c9\u611f|heatwave|heat wave|hot weather|extreme heat|cooling|canicule|forte chaleur|hitzewelle|extreme hitze|ola de calor|calor extremo|ondata di caldo|caldo estremo)/i;
const portableCoolingIntentPattern =
  /(\u98ce\u6247|\u624b\u6301|\u4fbf\u643a|\u968f\u8eab|\u964d\u6e29\u795e\u5668|\u6563\u70ed|\u901a\u52e4|\u6237\u5916|\u9732\u8425|fan|handheld|portable|personal cooling|commute|camping)/i;
const rainProductIntentPattern =
  /(\u901a\u52e4|\u51fa\u884c|\u978b|\u978b\u5957|\u96e8\u5177|\u9632\u6c34|\u9632\u6ed1|\u8db3\u90e8|\u6dcc\u6c34|\u6d89\u6c34|commute|shoe|footwear|rain gear|waterproof|non-slip)/i;
const petPattern = /(\u5ba0\u7269|\u732b|\u72d7|\u6bdb\u5b69\u5b50|\u517b\u5ba0|\u51a0\u6bdb\u72ac|pet|cat|dog|puppy)/i;
const carPattern =
  /(\u6c7d\u8f66|\u8f66\u5185|\u8f66\u8f7d|SUV|\u906e\u9633|\u9632\u6652|\u8f66\u7a97|\u6321\u98ce\u73bb\u7483|\u540e\u5907\u7bb1|\u88c5\u8f7d\u6536\u7eb3|car|vehicle|windshield|sun shade|car interior)/i;
const noisePattern =
  /(\u51b0\u7ea2\u8336|\u5976\u8336|\u996e\u6599|\u706b\u9505|\u7535\u5f71|\u6f14\u5531\u4f1a|\u7403\u8d5b|\u5267|\u660e\u661f|\u6b4c|\u821e|\u6e38\u620f|\u9884\u552e|\u7968\u623f|\u5b98\u5ba3)/i;

export function mapHotTopicToProduct(title: string): ProductMapping | null {
  if (noisePattern.test(title)) return null;

  if (petPattern.test(title) && heatPattern.test(title)) {
    return {
      keyword: "pet cooling mat",
      market: "CN",
      category: "pet",
      demand: "pet heat protection",
      confidence: 0.74
    };
  }

  if (carPattern.test(title) && (heatPattern.test(title) || /\u6536\u7eb3|\u88c5\u8f7d/.test(title))) {
    return {
      keyword: "car sun shade",
      market: "CN",
      category: "auto",
      demand: "car cabin cooling or storage",
      confidence: 0.7
    };
  }

  if (outdoorWeatherPattern.test(title) && rainProductIntentPattern.test(title)) {
    return {
      keyword: "waterproof shoe cover",
      market: "CN",
      category: "outdoor",
      demand: "rainstorm commuting protection",
      confidence: 0.72
    };
  }

  if (heatPattern.test(title) && portableCoolingIntentPattern.test(title)) {
    return {
      keyword: "portable fan",
      market: "CN",
      category: "small-appliance",
      demand: "personal cooling",
      confidence: 0.7
    };
  }

  if (heatPattern.test(title)) {
    return {
      keyword: "portable fan",
      market: "CN",
      category: "small-appliance",
      demand: "seasonal personal cooling hypothesis",
      confidence: 0.5
    };
  }

  return null;
}

export function normalizeHotItemToSignal(
  item: HotListItem,
  sourceRoute: string,
  sourceConfig: Pick<HotListSourceConfig, "source" | "methodology" | "riskLevel" | "baseUrl">
): TrendSignal | null {
  const title = stringify(item.title ?? item.word ?? item.keyword);
  if (!title) return null;
  const mapped = mapHotTopicToProduct(title);
  if (!mapped) return null;

  const rank = parseNumber(item.rank ?? item.index);
  const heat = parseHeat(item.hot_value ?? item.hot ?? item.score ?? item.score_desc);
  const currentIndex = scoreToIndex(heat, rank);
  const baselineIndex = Math.max(10, Math.round(currentIndex * 0.48));
  const platform = normalizePlatform(sourceRoute);
  const url = stringify(item.link ?? item.url ?? item.mobileUrl) || routeEvidenceUrl(sourceConfig.baseUrl, sourceRoute);

  return {
    id: `hotlist-${sourceRoute.replace(/[^a-z0-9]+/gi, "-")}-${hashTitle(title)}`,
    source: `${sourceConfig.source} ${sourceRoute}`,
    origin: "live",
    sourceKind: "third_party",
    sourceRisk: sourceConfig.riskLevel,
    retrievedAt: new Date().toISOString(),
    methodology: sourceConfig.methodology,
    platformType: "content",
    keyword: mapped.keyword,
    market: mapped.market,
    category: mapped.category,
    observedAt: new Date().toISOString(),
    currentIndex,
    baselineIndex,
    growthRate: (currentIndex - baselineIndex) / baselineIndex,
    confidence: mapped.confidence,
    evidence: `Hot topic "${title}" on ${sourceRoute} mapped to ${mapped.demand}.`,
    sourceUrl: url || undefined,
    sourcePlatform: platform,
    sourceTopic: title,
    mappingConfidence: mapped.confidence
  };
}

function createHotListAdapter(config: HotListSourceConfig): TrendSourceAdapter {
  return {
    name: config.name,
    type: "content",
    riskLevel: config.riskLevel,
    async discoverSignals() {
      latestCollectionRecords.set(config.name, []);
      if (config.transport === "http" && !config.baseUrl) return [];
      const results = await Promise.allSettled(
        config.routes.map(async (route) => {
          const items = await fetchHotList(config, route);
          const collectedAt = new Date().toISOString();
          const records: CollectionRecord[] = [];
          const signals: TrendSignal[] = [];
          items.forEach((item, index) => {
            const title = stringify(item.title ?? item.word ?? item.keyword);
            if (!title) return;
            const signal = normalizeHotItemToSignal(item, route, config);
            if (signal) signals.push(signal);
            const heat = parseHeat(item.hot_value ?? item.hot ?? item.score ?? item.score_desc);
            const rank = parseNumber(item.rank ?? item.index) ?? index + 1;
            records.push({
              id: `${config.name}-${normalizePlatform(route)}-${hashTitle(title)}`,
              channel: config.name,
              platform: normalizePlatform(route),
              market: "CN",
              title,
              collectedAt,
              observedAt: collectedAt,
              metricLabel: heat > 0 ? "热度" : "榜单排名",
              metricValue: heat > 0 ? heat : rank,
              rank,
              sourceUrl: stringify(item.link ?? item.url ?? item.mobileUrl) || routeEvidenceUrl(config.baseUrl, route),
              outcome: signal ? "mapped" : "filtered",
              enteredAnalysis: Boolean(signal),
              mappedKeyword: signal?.keyword,
              category: signal?.category,
              mappingConfidence: signal?.mappingConfidence,
              reason: signal ? "命中商品场景规则，已进入机会分析。" : "未命中商品意图规则，保留在采集台账中。",
              origin: "live"
            });
          });
          return { records, signals };
        })
      );
      latestCollectionRecords.set(
        config.name,
        results.flatMap((result) => (result.status === "fulfilled" ? result.value.records : []))
      );
      return dedupeSignals(
        results.flatMap((result) => (result.status === "fulfilled" ? result.value.signals : []))
      ).slice(0, 24);
    }
  };
}

export function getHotListCollectionRecords(channel: string) {
  return latestCollectionRecords.get(channel) ?? [];
}

async function fetchHotList(config: HotListSourceConfig, route: string): Promise<HotListItem[]> {
  if (config.transport === "embedded-daily-hot") {
    const { default: dailyHotApp } = await import("dailyhot-api/dist/app.js");
    const response = await withTimeout(
      Promise.resolve(dailyHotApp.request(new Request(`http://embedded.local/${route}`))),
      `embedded DailyHot ${route}`
    );
    return parseHotListResponse(response, route);
  }

  const baseUrl = config.baseUrl;
  if (!baseUrl) return [];
  const body = await fetchAdapterText(joinUrl(baseUrl, route), {
    label: `hot list API ${route}`,
    timeoutMs: HOT_LIST_TIMEOUT_MS,
    maximumBytes: 1_000_000,
    init: { headers: { "User-Agent": "yanchao-opportunity-radar/0.1" } }
  });
  return parseHotListBody(body);
}

async function parseHotListResponse(response: Response, route: string) {
  if (!response.ok) throw new Error(`hot list API ${route} failed: ${response.status}`);
  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > 1_000_000) throw new Error(`hot list API ${route} response exceeded 1 MB`);
  return parseHotListBody(body);
}

function parseHotListBody(body: string) {
  const payload = hotListPayloadSchema.parse(JSON.parse(body) as unknown) as HotListPayload | HotListItem[];
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload.data) ? payload.data : [];
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${HOT_LIST_TIMEOUT_MS}ms`)),
      HOT_LIST_TIMEOUT_MS
    );
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

function dedupeSignals(signals: TrendSignal[]) {
  const seen = new Set<string>();
  return signals.filter((signal) => {
    const key = `${signal.sourcePlatform ?? signal.source}:${signal.keyword}:${normalizeTopic(signal.sourceTopic ?? signal.evidence)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function scoreToIndex(score: number, rank?: number) {
  const scoreIndex = Math.min(92, Math.round(Math.log10(Math.max(score, 1)) * 12));
  const rankBoost = rank ? Math.max(0, 24 - rank) : 0;
  return Math.max(18, Math.min(100, scoreIndex + rankBoost));
}

function parseHeat(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return 0;
  const numeric = Number(value.replace(/[^\d.]/g, ""));
  if (Number.isNaN(numeric)) return 0;
  if (/w|W|\u4e07/.test(value)) return numeric * 10_000;
  return numeric;
}

function parseNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return undefined;
  const numeric = Number(value.replace(/[^\d.]/g, ""));
  return Number.isNaN(numeric) ? undefined : numeric;
}

function stringify(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function joinUrl(baseUrl: string, route: string) {
  return `${baseUrl.replace(/\/+$/, "")}/${route.replace(/^\/+/, "")}`;
}

function routeEvidenceUrl(baseUrl: string | undefined, route: string) {
  if (!baseUrl) return undefined;
  return joinUrl(baseUrl, route);
}

function normalizePlatform(route: string) {
  const platform = route.split("/")[0].toLowerCase();
  return platform === "bili" ? "bilibili" : platform;
}

function normalizeTopic(topic: string) {
  return topic
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function hashTitle(title: string) {
  let hash = 0;
  for (let index = 0; index < title.length; index += 1) {
    hash = (hash * 31 + title.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

export const dailyHotApiAdapter = createHotListAdapter(dailyHotConfig);
export const sixtySecondsHotAdapter = createHotListAdapter(sixtySecondsConfig);
