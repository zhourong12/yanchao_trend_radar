import { z } from "zod";
import type { SalesSignal } from "../../shared/types";
import { fetchAdapterJson } from "./adapterHttp";

export type SalesSourceProviderId = "keepa" | "rainforest" | "amazon-sp-api" | "custom";

export interface SalesSourceProvider {
  id: SalesSourceProviderId;
  label: string;
  sourceKind: SalesSignal["sourceKind"];
  sourceRisk: SalesSignal["sourceRisk"];
  fetchSales(keyword: string, market: string): Promise<SalesSignal>;
}

const salesPayloadSchema = z.object({
  platform: z.string().min(1),
  competitorCount: z.number().nonnegative(),
  targetPriceUsd: z.number().nonnegative(),
  reviewPainPoints: z.array(z.string()),
  demandProxy: z.number().min(0).max(100),
  observedAt: z.string().datetime().optional()
});

const providerMetadata: Record<
  SalesSourceProviderId,
  Pick<SalesSourceProvider, "label" | "sourceKind" | "sourceRisk">
> = {
  keepa: { label: "Keepa", sourceKind: "third_party", sourceRisk: "medium" },
  rainforest: { label: "Rainforest API", sourceKind: "third_party", sourceRisk: "medium" },
  "amazon-sp-api": { label: "Amazon SP-API", sourceKind: "official", sourceRisk: "low" },
  custom: { label: "Configured sales gateway", sourceKind: "third_party", sourceRisk: "medium" }
};

const providerIdSchema = z.enum(["keepa", "rainforest", "amazon-sp-api", "custom"]);
const SALES_TIMEOUT_MS = 8_000;
const MAXIMUM_RESPONSE_BYTES = 1_000_000;

export function createConfiguredSalesProvider(): SalesSourceProvider | null {
  const endpoint = process.env.SALES_SOURCE_API_URL;
  if (!endpoint) return null;

  const providerId = providerIdSchema.parse(process.env.SALES_SOURCE_PROVIDER ?? "custom");
  const metadata = providerMetadata[providerId];
  return {
    id: providerId,
    ...metadata,
    async fetchSales(keyword, market) {
      const url = new URL(endpoint);
      url.searchParams.set("keyword", keyword);
      url.searchParams.set("market", market);
      const payload = salesPayloadSchema.parse(
        await fetchAdapterJson(url, {
          label: "Sales source",
          timeoutMs: SALES_TIMEOUT_MS,
          maximumBytes: MAXIMUM_RESPONSE_BYTES,
          init: {
            headers: {
              "User-Agent": "yanchao-opportunity-radar/0.2",
              ...(process.env.SALES_SOURCE_API_TOKEN
                ? { Authorization: `Bearer ${process.env.SALES_SOURCE_API_TOKEN}` }
                : {})
            }
          }
        })
      );
      return {
        platform: payload.platform,
        competitorCount: payload.competitorCount,
        targetPriceUsd: payload.targetPriceUsd,
        reviewPainPoints: payload.reviewPainPoints,
        demandProxy: payload.demandProxy,
        observedAt: payload.observedAt,
        origin: "live",
        sourceKind: metadata.sourceKind,
        sourceRisk: metadata.sourceRisk,
        sourceUrl: endpoint
      };
    }
  };
}
