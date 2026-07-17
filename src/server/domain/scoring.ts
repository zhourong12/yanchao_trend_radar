import type { FeedbackAction, OpportunityScores, SalesSignal, SupplySignal, TrendSignal } from "../../shared/types";
import { scoringConfig } from "./scoringConfig";

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const { sourceRiskFactor, sourceKindFactor } = scoringConfig;

function effectiveConfidence(signal: TrendSignal) {
  return clamp(signal.confidence * sourceRiskFactor[signal.sourceRisk] * sourceKindFactor[signal.sourceKind], 0, 1);
}

function isVerified(signal: SupplySignal | SalesSignal) {
  return signal.origin === "live" && signal.sourceKind !== "seed" && !signal.isFallback;
}

function evidenceReliability(signal: SupplySignal | SalesSignal) {
  return sourceRiskFactor[signal.sourceRisk] * sourceKindFactor[signal.sourceKind];
}

export function calculateTrendScore(signals: TrendSignal[]): number {
  if (signals.length === 0) return 0;
  const signalScore =
    signals.reduce((sum, signal) => {
      const growth = Math.log1p(Math.max(signal.growthRate, 0)) * scoringConfig.trend.growth;
      const index = signal.currentIndex * scoringConfig.trend.index;
      const confidence = effectiveConfidence(signal) * scoringConfig.trend.confidence;
      return sum + clamp(growth + index + confidence);
    }, 0) / signals.length;
  const multiPlatformBoost =
    new Set(signals.map((signal) => signal.sourcePlatform ?? signal.source)).size > 1
      ? scoringConfig.trend.multiPlatformBoost
      : 0;
  return Math.round(clamp(signalScore + multiPlatformBoost));
}

export function calculateSupplyScore(supply: SupplySignal): number {
  if (!isVerified(supply) || supply.supplierCount <= 0 || supply.minPriceCny <= 0 || supply.maxPriceCny <= 0) return 0;
  const supplierScore = clamp(Math.log1p(supply.supplierCount) * scoringConfig.supply.supplierLog);
  const moqScore =
    supply.moq <= scoringConfig.supply.moq.lowThreshold
      ? scoringConfig.supply.moq.lowScore
      : supply.moq <= scoringConfig.supply.moq.mediumThreshold
        ? scoringConfig.supply.moq.mediumScore
        : scoringConfig.supply.moq.highScore;
  const leadTimeScore =
    supply.leadTimeDays <= scoringConfig.supply.leadTime.fastThreshold
      ? scoringConfig.supply.leadTime.fastScore
      : supply.leadTimeDays <= scoringConfig.supply.leadTime.normalThreshold
        ? scoringConfig.supply.leadTime.normalScore
        : scoringConfig.supply.leadTime.slowScore;
  const priceSpreadScore =
    supply.maxPriceCny / Math.max(supply.minPriceCny, 1) <= scoringConfig.supply.priceSpreadThreshold
      ? scoringConfig.supply.stablePriceScore
      : scoringConfig.supply.widePriceScore;
  return Math.round(clamp(supplierScore + moqScore + leadTimeScore + priceSpreadScore));
}

export function calculateRiskScore(supply: SupplySignal): number {
  if (!isVerified(supply) || supply.complianceTags.includes("unknown")) return 0;
  const riskPenalty =
    supply.complianceTags.filter((tag) => scoringConfig.risk.highRiskTags.some((riskTag) => riskTag === tag)).length *
    scoringConfig.risk.tagPenalty;
  return Math.round(clamp(scoringConfig.risk.base - riskPenalty));
}

export function calculateEvidenceCompleteness(signals: TrendSignal[], supply: SupplySignal, sales: SalesSignal) {
  const liveSignals = signals.filter((signal) => signal.origin === "live");
  const trendEvidence =
    liveSignals.length === 0
      ? 0
      : Math.min(1, liveSignals.length / scoringConfig.evidence.targetSourceCount) * scoringConfig.evidence.trend;
  const platformEvidence =
    Math.min(
      1,
      new Set(liveSignals.map((signal) => signal.sourcePlatform ?? signal.source)).size /
        scoringConfig.evidence.targetSourceCount
    ) * scoringConfig.evidence.platforms;
  const supplyEvidence = isVerified(supply) ? scoringConfig.evidence.supply : 0;
  const salesEvidence = isVerified(sales) ? scoringConfig.evidence.sales * evidenceReliability(sales) : 0;
  return Math.round((trendEvidence + platformEvidence + supplyEvidence + salesEvidence) * 100);
}

export function calculateDecisionReadiness(signals: TrendSignal[], supply: SupplySignal, sales: SalesSignal) {
  const completeness = calculateEvidenceCompleteness(signals, supply, sales);
  const liveTrendAvailable = signals.some((signal) => signal.origin === "live");
  const verifiedBusinessEvidence = Number(isVerified(supply)) + Number(isVerified(sales));
  const readinessCap = !liveTrendAvailable
    ? scoringConfig.readinessCaps.noLiveTrend
    : verifiedBusinessEvidence === 0
      ? scoringConfig.readinessCaps.noBusinessEvidence
      : verifiedBusinessEvidence === 1
        ? scoringConfig.readinessCaps.partialBusinessEvidence
        : scoringConfig.readinessCaps.complete;
  return Math.round(Math.min(completeness, readinessCap));
}

export function calculateOpportunityScores(
  signals: TrendSignal[],
  supply: SupplySignal,
  sales: SalesSignal,
  feedback: FeedbackAction[] = []
): OpportunityScores {
  const trend = calculateTrendScore(signals);
  const supplyScore = calculateSupplyScore(supply);
  const salesVerified = isVerified(sales);
  const hasSalesEvidence =
    salesVerified && sales.targetPriceUsd > 0 && sales.competitorCount > 0 && sales.demandProxy > 0;
  const salesReliability = hasSalesEvidence ? evidenceReliability(sales) : 0;
  const estimatedContributionCny = hasSalesEvidence
    ? sales.targetPriceUsd * scoringConfig.monetization.usdToCny * scoringConfig.monetization.priceRealization -
      supply.minPriceCny * scoringConfig.monetization.landedCostMultiplier
    : 0;
  const monetization = hasSalesEvidence
    ? clamp(
        (estimatedContributionCny * scoringConfig.monetization.contributionWeight +
          sales.demandProxy * scoringConfig.monetization.demandWeight) *
          salesReliability
      )
    : 0;
  const competition = hasSalesEvidence
    ? clamp(
        (100 - Math.log1p(sales.competitorCount) * scoringConfig.monetization.competitionLogPenalty) * salesReliability
      )
    : 0;
  const risk = calculateRiskScore(supply);
  const confidence =
    signals.length === 0
      ? 0
      : clamp((signals.reduce((sum, signal) => sum + effectiveConfidence(signal), 0) / signals.length) * 100);
  const evidenceCompleteness = calculateEvidenceCompleteness(signals, supply, sales);
  const decisionReadiness = calculateDecisionReadiness(signals, supply, sales);
  const feedbackAdjustment = calculateFeedbackAdjustment(feedback);
  const weights = scoringConfig.overallWeights;
  const rawOverall =
    trend * weights.trend +
    supplyScore * weights.supply +
    monetization * weights.monetization +
    competition * weights.competition +
    risk * weights.risk +
    confidence * weights.confidence;
  const overall =
    signals.length === 0
      ? 0
      : rawOverall *
          (scoringConfig.completenessMultiplier.base +
            (evidenceCompleteness / 100) * scoringConfig.completenessMultiplier.variable) +
        feedbackAdjustment;

  return {
    trend: Math.round(trend),
    supply: Math.round(supplyScore),
    monetization: Math.round(monetization),
    competition: Math.round(competition),
    risk: Math.round(risk),
    confidence: Math.round(confidence),
    feedbackAdjustment,
    rawOverall: Math.round(clamp(rawOverall)),
    evidenceCompleteness,
    decisionReadiness,
    overall: Math.round(clamp(overall))
  };
}

export function calculateFeedbackAdjustment(feedback: FeedbackAction[]) {
  const latest = feedback.at(-1);
  const lastAction = latest?.action;
  const outcome = latest?.outcome;
  const outcomeAdjustment = outcome
    ? clamp(
        Math.log1p(outcome.unitsSold ?? 0) * 1.5 +
          Math.log1p(Math.max(0, outcome.grossProfitUsd ?? 0)) * 1.2 -
          Math.max(0, -(outcome.grossProfitUsd ?? 0)) * 0.08 -
          (outcome.returnRate ?? 0) * 25,
        -20,
        20
      )
    : 0;
  if (lastAction === "listed") return Math.round(scoringConfig.feedback.listed + outcomeAdjustment);
  if (lastAction === "sampling") return Math.round(scoringConfig.feedback.sampling + outcomeAdjustment);
  if (lastAction === "verifying") return Math.round(scoringConfig.feedback.verifying + outcomeAdjustment);
  if (lastAction === "follow_up" || lastAction === "useful")
    return Math.round(scoringConfig.feedback.followUp + outcomeAdjustment);
  if (lastAction === "rejected" || lastAction === "not_useful")
    return Math.round(scoringConfig.feedback.rejected + outcomeAdjustment);
  return 0;
}
