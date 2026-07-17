import { salesByKeyword, supplyByKeyword, trendSignals } from "../data/seed";
import type { SalesSourceAdapter, SupplySourceAdapter, TrendSourceAdapter } from "./types";

export const seedTrendAdapter: TrendSourceAdapter = {
  name: "seed-trend-adapter",
  type: "trend",
  riskLevel: "low",
  async discoverSignals() {
    return trendSignals;
  }
};

export const seedSupplyAdapter: SupplySourceAdapter = {
  name: "seed-supply-adapter",
  type: "supply",
  riskLevel: "low",
  async fetchSupply(keyword) {
    return (
      supplyByKeyword[keyword] ?? {
        productName: keyword,
        origin: "seed",
        sourceKind: "seed",
        sourceRisk: "low",
        supplierCount: 0,
        minPriceCny: 0,
        maxPriceCny: 0,
        moq: 0,
        leadTimeDays: 0,
        complianceTags: ["unknown"]
      }
    );
  }
};

export const seedSalesAdapter: SalesSourceAdapter = {
  name: "seed-sales-adapter",
  type: "sales",
  riskLevel: "low",
  async fetchSales(keyword) {
    return (
      salesByKeyword[keyword] ?? {
        platform: "Amazon",
        origin: "seed",
        sourceKind: "seed",
        sourceRisk: "low",
        competitorCount: 0,
        targetPriceUsd: 0,
        reviewPainPoints: [],
        demandProxy: 0
      }
    );
  }
};
