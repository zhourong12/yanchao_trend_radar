import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import type { TrendCandidate, TrendSignal } from "../../shared/types";
import type { TrendSourceAdapter } from "./types";
import { fetchAdapterText } from "./adapterHttp";
import { mapHotTopicToProduct } from "./hotListAdapters";
import { configuredGoogleGeos } from "./liveAdapters";

const GOOGLE_TRENDING_TIMEOUT_MS = 6_000;
const GOOGLE_TRENDING_CACHE_MS = 10 * 60_000;
const MAXIMUM_RESPONSE_BYTES = 2_000_000;

const itemSchema = z.object({
  title: z.string().min(1),
  approx_traffic: z.string().optional(),
  pubDate: z.string().optional()
});

const feedSchema = z.object({
  rss: z.object({
    channel: z.object({
      item: z.array(itemSchema).optional()
    })
  })
});

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
  isArray: (_name, path) => path === "rss.channel.item"
});

let candidateCache: { expiresAt: number; candidates: TrendCandidate[] } | null = null;
let candidateDiscovery: Promise<TrendCandidate[]> | null = null;

export function invalidateGoogleTrendingCache() {
  candidateCache = null;
}

export function getCachedGoogleTrendingCandidates() {
  return candidateCache?.candidates ?? [];
}

export function parseGoogleTrendingCandidates(xml: string, geo: string): TrendCandidate[] {
  if (Buffer.byteLength(xml, "utf8") > MAXIMUM_RESPONSE_BYTES) {
    throw new Error("Google Trending RSS response exceeded 2 MB");
  }
  const payload = feedSchema.parse(parser.parse(xml) as unknown);
  const observedAtFallback = new Date().toISOString();
  return (payload.rss.channel.item ?? []).map((item) => {
    const mapped = mapHotTopicToProduct(item.title);
    return {
      id: `google-trending-${geo.toLowerCase()}-${hashTitle(item.title)}`,
      source: "Google Trends Trending Now",
      market: geo,
      query: item.title,
      approximateTraffic: parseApproximateTraffic(item.approx_traffic),
      observedAt: validDate(item.pubDate) ?? observedAtFallback,
      sourceUrl: `https://trends.google.com/trending?geo=${encodeURIComponent(geo)}`,
      matchedKeyword: mapped?.keyword,
      category: mapped?.category,
      mappingConfidence: mapped?.confidence
    } satisfies TrendCandidate;
  });
}

export function mapGoogleTrendingCandidatesToSignals(candidates: TrendCandidate[]): TrendSignal[] {
  return candidates
    .filter((candidate): candidate is TrendCandidate & { matchedKeyword: string; category: string } =>
      Boolean(candidate.matchedKeyword && candidate.category)
    )
    .map((candidate, rank) => {
      const currentIndex = trafficToIndex(candidate.approximateTraffic, rank + 1);
      return {
        id: candidate.id,
        source: candidate.source,
        origin: "live",
        sourceKind: "official",
        sourceRisk: "low",
        retrievedAt: new Date().toISOString(),
        methodology:
          "Official Google Trends Trending Now RSS discovery without a seed keyword; currentIndex is normalized from approximate traffic and rank, while growthRate remains 0 because the feed has no historical baseline.",
        platformType: "trend",
        keyword: candidate.matchedKeyword,
        market: candidate.market,
        category: candidate.category,
        observedAt: candidate.observedAt,
        currentIndex,
        baselineIndex: currentIndex,
        growthRate: 0,
        confidence: Math.min(0.9, (candidate.mappingConfidence ?? 0.62) + 0.08),
        evidence: `Trending Google query "${candidate.query}" in ${candidate.market}${candidate.approximateTraffic > 0 ? ` with approximately ${candidate.approximateTraffic}+ searches` : ""}.`,
        sourceUrl: candidate.sourceUrl,
        sourcePlatform: "google-trending",
        sourceTopic: candidate.query,
        mappingConfidence: candidate.mappingConfidence
      } satisfies TrendSignal;
    })
    .slice(0, 120);
}

export function parseGoogleTrendingRss(xml: string, geo: string): TrendSignal[] {
  return mapGoogleTrendingCandidatesToSignals(parseGoogleTrendingCandidates(xml, geo));
}

export async function discoverGoogleTrendingCandidates() {
  if (candidateCache && candidateCache.expiresAt > Date.now()) return candidateCache.candidates;
  if (candidateDiscovery) return candidateDiscovery;
  candidateDiscovery = (async () => {
    const results = await Promise.allSettled(configuredGoogleGeos().map((geo) => fetchCountryFeed(geo)));
    const candidates = results
      .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
      .sort((a, b) => b.approximateTraffic - a.approximateTraffic)
      .slice(0, 500);
    candidateCache = { expiresAt: Date.now() + GOOGLE_TRENDING_CACHE_MS, candidates };
    return candidates;
  })().finally(() => {
    candidateDiscovery = null;
  });
  return candidateDiscovery;
}

export const googleTrendingDiscoveryAdapter: TrendSourceAdapter = {
  name: "google-trends-discovery",
  type: "trend",
  riskLevel: "low",
  async discoverSignals() {
    return mapGoogleTrendingCandidatesToSignals(await discoverGoogleTrendingCandidates());
  }
};

async function fetchCountryFeed(geo: string) {
  const body = await fetchAdapterText(`https://trends.google.com/trending/rss?geo=${encodeURIComponent(geo)}`, {
    label: `Google Trending RSS ${geo}`,
    timeoutMs: GOOGLE_TRENDING_TIMEOUT_MS,
    maximumBytes: 2_000_000,
    init: { headers: { "User-Agent": "yanchao-opportunity-radar/0.2" } }
  });
  return parseGoogleTrendingCandidates(body, geo);
}

function parseApproximateTraffic(value?: string) {
  if (!value) return 0;
  const numeric = Number(value.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(numeric)) return 0;
  if (/M/i.test(value)) return numeric * 1_000_000;
  if (/K/i.test(value)) return numeric * 1_000;
  return numeric;
}

function trafficToIndex(traffic: number, rank: number) {
  const trafficIndex = traffic > 0 ? Math.round(Math.log10(traffic + 1) * 18) : 24;
  const rankBoost = Math.max(0, 16 - rank);
  return Math.min(100, Math.max(18, trafficIndex + rankBoost));
}

function validDate(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function hashTitle(title: string) {
  let hash = 0;
  for (let index = 0; index < title.length; index += 1) hash = (hash * 31 + title.charCodeAt(index)) >>> 0;
  return hash.toString(36);
}
