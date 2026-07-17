import { describe, expect, it } from "vitest";
import { salesByKeyword, supplyByKeyword, trendSignals } from "../data/seed";
import {
  calculateDecisionReadiness,
  calculateEvidenceCompleteness,
  calculateFeedbackAdjustment,
  calculateOpportunityScores,
  calculateRiskScore,
  calculateSupplyScore,
  calculateTrendScore
} from "./scoring";
import { scoringConfig } from "./scoringConfig";

describe("scoring", () => {
  it("locks the externally defined overall weights and source discounts", () => {
    expect(Object.values(scoringConfig.overallWeights).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
    expect(scoringConfig.sourceKindFactor).toEqual({ official: 1, third_party: 0.82, unofficial: 0.72, seed: 0.58 });
    expect(scoringConfig.sourceRiskFactor).toEqual({ low: 1, medium: 0.78, high: 0.5 });
  });
  it("scores strong trend signals above weak baselines", () => {
    const portableFanSignals = trendSignals.filter((signal) => signal.keyword === "portable fan");

    expect(calculateTrendScore(portableFanSignals)).toBeGreaterThan(70);
  });

  it("penalizes compliance-sensitive supply", () => {
    const batterySupply = {
      ...supplyByKeyword["portable fan"],
      origin: "live" as const,
      sourceKind: "third_party" as const
    };
    const lowRiskSupply = {
      ...supplyByKeyword["car sun shade"],
      origin: "live" as const,
      sourceKind: "third_party" as const
    };
    expect(calculateRiskScore(batterySupply)).toBeLessThan(calculateRiskScore(lowRiskSupply));
  });

  it("rewards accessible supply", () => {
    expect(calculateSupplyScore(supplyByKeyword["portable fan"])).toBe(0);
  });

  it("creates bounded opportunity scores", () => {
    const signals = trendSignals.filter((signal) => signal.keyword === "pet cooling mat");
    const score = calculateOpportunityScores(
      signals,
      supplyByKeyword["pet cooling mat"],
      salesByKeyword["pet cooling mat"]
    );

    expect(score.overall).toBeGreaterThanOrEqual(0);
    expect(score.overall).toBeLessThanOrEqual(100);
    expect(score.confidence).toBeGreaterThan(30);
    expect(score.confidence).toBeLessThan(70);
  });

  it("does not let demo supply and sales data create false decision confidence", () => {
    const signals = trendSignals.filter((signal) => signal.keyword === "pet cooling mat");
    const score = calculateOpportunityScores(
      signals,
      supplyByKeyword["pet cooling mat"],
      salesByKeyword["pet cooling mat"]
    );

    expect(score.supply).toBe(0);
    expect(score.monetization).toBe(0);
    expect(score.evidenceCompleteness).toBeLessThan(60);
    expect(score.overall).toBeLessThan(70);
  });

  it("discounts third-party sales evidence by provenance risk", () => {
    const signals = trendSignals
      .filter((signal) => signal.keyword === "pet cooling mat")
      .map((signal) => ({ ...signal, origin: "live" as const }));
    const supply = {
      ...supplyByKeyword["pet cooling mat"],
      origin: "live" as const,
      sourceKind: "official" as const,
      sourceRisk: "low" as const,
      isFallback: false
    };
    const officialSales = {
      ...salesByKeyword["pet cooling mat"],
      targetPriceUsd: 10,
      demandProxy: 50,
      origin: "live" as const,
      sourceKind: "official" as const,
      sourceRisk: "low" as const,
      isFallback: false
    };
    const thirdPartySales = {
      ...officialSales,
      sourceKind: "third_party" as const,
      sourceRisk: "medium" as const
    };

    expect(calculateEvidenceCompleteness(signals, supply, officialSales)).toBeGreaterThan(
      calculateEvidenceCompleteness(signals, supply, thirdPartySales)
    );
    expect(calculateDecisionReadiness(signals, supply, officialSales)).toBeGreaterThan(
      calculateDecisionReadiness(signals, supply, thirdPartySales)
    );
    expect(calculateOpportunityScores(signals, supply, officialSales).monetization).toBeGreaterThan(
      calculateOpportunityScores(signals, supply, thirdPartySales).monetization
    );
  });

  it("uses the latest feedback outcome to calibrate ranking", () => {
    expect(calculateFeedbackAdjustment([{ opportunityId: "x", action: "listed" }])).toBe(8);
    expect(calculateFeedbackAdjustment([{ opportunityId: "x", action: "rejected" }])).toBe(-20);
    expect(
      calculateFeedbackAdjustment([
        {
          opportunityId: "x",
          action: "listed",
          outcome: {
            observedAt: "2026-07-16T00:00:00.000Z",
            unitsSold: 100,
            grossProfitUsd: 500,
            returnRate: 0.03
          }
        }
      ])
    ).toBeGreaterThan(8);
    expect(
      calculateFeedbackAdjustment([
        {
          opportunityId: "x",
          action: "listed",
          outcome: {
            observedAt: "2026-07-16T00:00:00.000Z",
            grossProfitUsd: -300,
            returnRate: 0.4
          }
        }
      ])
    ).toBeLessThan(8);
  });

  it("does not return NaN for empty signal lists", () => {
    const score = calculateOpportunityScores([], supplyByKeyword["portable fan"], salesByKeyword["portable fan"]);

    expect(Number.isNaN(score.overall)).toBe(false);
    expect(score.overall).toBe(0);
  });
});
