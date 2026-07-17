import type { SalesSignal, SupplySignal, TrendSignal } from "../../shared/types";

export interface TrendSourceAdapter {
  name: string;
  type: "trend" | "content" | "supply" | "sales";
  riskLevel: "low" | "medium" | "high";
  discoverSignals(): Promise<TrendSignal[]>;
}

export interface SupplySourceAdapter {
  name: string;
  type: "supply";
  riskLevel: "low" | "medium" | "high";
  fetchSupply(keyword: string): Promise<SupplySignal>;
}

export interface SalesSourceAdapter {
  name: string;
  type: "sales";
  riskLevel: "low" | "medium" | "high";
  fetchSales(keyword: string, market: string): Promise<SalesSignal>;
}
