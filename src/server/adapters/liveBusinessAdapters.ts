import { z } from "zod";
import type { SalesSignal, SupplySignal } from "../../shared/types";
import { fetchAdapterJson } from "./adapterHttp";
import { createConfiguredSalesProvider, type SalesSourceProviderId } from "./salesSourceAdapter";

const supplyPayloadSchema = z.object({
  productName: z.string().min(1),
  supplierCount: z.number().nonnegative(),
  minPriceCny: z.number().nonnegative(),
  maxPriceCny: z.number().nonnegative(),
  moq: z.number().nonnegative(),
  leadTimeDays: z.number().nonnegative(),
  complianceTags: z.array(z.string())
});

const LIVE_BUSINESS_TIMEOUT_MS = 8_000;
const DEFAULT_SALES_CACHE_TTL_MS = 15 * 60 * 1000;
const salesCache = new Map<string, { expiresAt: number; signal: SalesSignal }>();
let configuredSalesState: {
  configured: boolean;
  ok: boolean;
  provider?: SalesSourceProviderId;
  riskLevel?: SalesSignal["sourceRisk"];
  cacheHit?: boolean;
  lastCheckedAt?: string;
  error?: string;
} = { configured: Boolean(process.env.SALES_SOURCE_API_URL), ok: false };

export async function fetchConfiguredSupply(keyword: string, market: string): Promise<SupplySignal | null> {
  const endpoint = process.env.SUPPLY_SOURCE_API_URL;
  if (!endpoint) return null;
  const url = new URL(endpoint);
  url.searchParams.set("keyword", keyword);
  url.searchParams.set("market", market);
  const payload = await fetchAdapterJson(url, {
    label: "Supply source",
    timeoutMs: LIVE_BUSINESS_TIMEOUT_MS,
    maximumBytes: 1_000_000,
    init: {
      headers: {
        "User-Agent": "yanchao-opportunity-radar/0.2",
        ...(process.env.SUPPLY_SOURCE_API_TOKEN
          ? { Authorization: `Bearer ${process.env.SUPPLY_SOURCE_API_TOKEN}` }
          : {})
      }
    }
  });
  const parsed = supplyPayloadSchema.parse(payload);
  return {
    ...parsed,
    origin: "live",
    sourceKind: "third_party",
    sourceRisk: "medium",
    sourceUrl: endpoint
  };
}

export async function fetchConfiguredSales(keyword: string, market: string): Promise<SalesSignal | null> {
  const provider = createConfiguredSalesProvider();
  if (!provider) {
    configuredSalesState = { configured: false, ok: false, error: "Amazon sales source is not configured" };
    return null;
  }
  const cacheKey = `${provider.id}:${market.trim().toUpperCase()}:${keyword.trim().toLowerCase()}`;
  const cached = salesCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    configuredSalesState = {
      configured: true,
      ok: true,
      provider: provider.id,
      riskLevel: cached.signal.sourceRisk,
      cacheHit: true,
      lastCheckedAt: new Date().toISOString()
    };
    return cached.signal;
  }
  const lastCheckedAt = new Date().toISOString();
  try {
    const signal = await provider.fetchSales(keyword, market);
    salesCache.set(cacheKey, { expiresAt: Date.now() + configuredSalesCacheTtlMs(), signal });
    configuredSalesState = {
      configured: true,
      ok: true,
      provider: provider.id,
      riskLevel: signal.sourceRisk,
      cacheHit: false,
      lastCheckedAt
    };
    return signal;
  } catch (error) {
    configuredSalesState = {
      configured: true,
      ok: false,
      provider: provider.id,
      cacheHit: false,
      lastCheckedAt,
      error: error instanceof Error ? error.message : String(error)
    };
    throw error;
  }
}

export function getConfiguredSalesState() {
  return configuredSalesState;
}

export function clearConfiguredSalesCache() {
  salesCache.clear();
}

function configuredSalesCacheTtlMs() {
  const seconds = Number(process.env.SALES_SOURCE_CACHE_TTL_SECONDS);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : DEFAULT_SALES_CACHE_TTL_MS;
}
