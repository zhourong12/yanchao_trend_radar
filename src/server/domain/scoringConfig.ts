export const scoringConfig = {
  sourceRiskFactor: { low: 1, medium: 0.78, high: 0.5 },
  sourceKindFactor: { official: 1, third_party: 0.82, unofficial: 0.72, seed: 0.58 },
  trend: { growth: 38, index: 0.45, confidence: 22, multiPlatformBoost: 6 },
  supply: {
    supplierLog: 13,
    moq: { lowThreshold: 10, mediumThreshold: 50, lowScore: 22, mediumScore: 14, highScore: 6 },
    leadTime: { fastThreshold: 3, normalThreshold: 7, fastScore: 20, normalScore: 13, slowScore: 5 },
    priceSpreadThreshold: 4,
    stablePriceScore: 12,
    widePriceScore: 5
  },
  evidence: { trend: 0.35, platforms: 0.15, supply: 0.25, sales: 0.25, targetSourceCount: 2 },
  readinessCaps: { noLiveTrend: 20, noBusinessEvidence: 40, partialBusinessEvidence: 70, complete: 100 },
  monetization: {
    usdToCny: 7.2,
    priceRealization: 0.62,
    landedCostMultiplier: 1.35,
    contributionWeight: 1.6,
    demandWeight: 0.25,
    competitionLogPenalty: 9.5
  },
  risk: { base: 88, tagPenalty: 18, highRiskTags: ["battery", "food-contact", "children", "medical"] },
  overallWeights: { trend: 0.45, supply: 0.15, monetization: 0.15, competition: 0.1, risk: 0.05, confidence: 0.1 },
  completenessMultiplier: { base: 0.7, variable: 0.3 },
  feedback: { listed: 8, sampling: 5, verifying: 3, followUp: 2, rejected: -20 }
} as const;
