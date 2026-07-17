export type PlatformType = "trend" | "content" | "supply" | "sales";

export type OpportunityStatus = "new" | "watching" | "follow_up" | "verifying" | "sampling" | "listed" | "rejected";

export type ValidationStatus = "pending" | "in_progress" | "verified" | "blocked";

export type DataQuality = "demo" | "mixed" | "verified";
export type OpportunityStage = "signal" | "hypothesis" | "validating" | "actionable";

export interface TrendSignal {
  id: string;
  source: string;
  origin: "live" | "seed";
  sourceKind: "official" | "third_party" | "unofficial" | "seed";
  sourceRisk: "low" | "medium" | "high";
  retrievedAt: string;
  methodology: string;
  isFallback?: boolean;
  platformType: PlatformType;
  keyword: string;
  market: string;
  category: string;
  observedAt: string;
  currentIndex: number;
  baselineIndex: number;
  growthRate: number;
  confidence: number;
  evidence: string;
  sourceUrl?: string;
  sourcePlatform?: string;
  sourceTopic?: string;
  mappingConfidence?: number;
}

export interface TrendCandidate {
  id: string;
  source: string;
  market: string;
  query: string;
  approximateTraffic: number;
  observedAt: string;
  sourceUrl: string;
  matchedKeyword?: string;
  category?: string;
  mappingConfidence?: number;
}

export type CollectionOutcome = "mapped" | "filtered" | "validation" | "demo";

export interface CollectionRecord {
  id: string;
  channel: string;
  platform: string;
  market?: string;
  title: string;
  collectedAt: string;
  observedAt?: string;
  metricLabel?: string;
  metricValue?: number;
  rank?: number;
  sourceUrl?: string;
  outcome: CollectionOutcome;
  enteredAnalysis: boolean;
  mappedKeyword?: string;
  category?: string;
  mappingConfidence?: number;
  reason: string;
  origin: "live" | "seed";
}

export interface CollectionChannelSummary {
  id: string;
  label: string;
  description: string;
  purpose: "discovery" | "validation" | "demo";
  ok: boolean;
  rawCount: number;
  mappedCount: number;
  validationCount: number;
  demoCount: number;
  filteredCount: number;
  lastCheckedAt?: string;
  freshnessStatus?: "fresh" | "stale" | "never";
  freshnessMinutes?: number;
  riskLevel?: "low" | "medium" | "high";
  error?: string;
}

export interface CollectionDashboard {
  date: string;
  generatedAt: string;
  timeZone: string;
  totalCollected: number;
  mappedCount: number;
  validationCount: number;
  demoCount: number;
  filteredCount: number;
  liveCount: number;
  records: CollectionRecord[];
  channels: CollectionChannelSummary[];
}

export interface SupplySignal {
  productName: string;
  origin: "live" | "seed";
  sourceKind: "official" | "third_party" | "unofficial" | "seed";
  sourceRisk: "low" | "medium" | "high";
  supplierCount: number;
  supplierCountIsSample?: boolean;
  sampleSize?: number;
  minPriceCny: number;
  maxPriceCny: number;
  moq: number;
  leadTimeDays: number;
  complianceTags: string[];
  isFallback?: boolean;
  sourceUrl?: string;
}

export interface MarketTrendPoint {
  market: string;
  value: number;
  sourceCount: number;
  observedAt: string;
  origin: "live" | "seed";
}

export interface SalesSignal {
  platform: string;
  origin: "live" | "seed";
  sourceKind: "official" | "third_party" | "unofficial" | "seed";
  sourceRisk: "low" | "medium" | "high";
  competitorCount: number;
  targetPriceUsd: number;
  reviewPainPoints: string[];
  demandProxy: number;
  observedAt?: string;
  isFallback?: boolean;
  sourceUrl?: string;
}

export interface EvidenceLink {
  label: string;
  url: string;
  kind: "supply_search" | "sales_search" | "trend_source";
}

export interface ValidationState {
  supply: ValidationStatus;
  sales: ValidationStatus;
  lastNote?: string;
  lastEvidenceUrl?: string;
  updatedAt?: string;
}

export interface FeedbackRecord extends FeedbackAction {
  createdAt: string;
}

export interface BusinessOutcome {
  observedAt: string;
  unitsSold?: number;
  revenueUsd?: number;
  grossProfitUsd?: number;
  returnRate?: number;
}

export interface OpportunityScores {
  trend: number;
  supply: number;
  monetization: number;
  competition: number;
  risk: number;
  confidence: number;
  feedbackAdjustment: number;
  rawOverall: number;
  evidenceCompleteness: number;
  decisionReadiness: number;
  overall: number;
}

export interface OpportunityEvidence {
  dataQuality: DataQuality;
  stage: OpportunityStage;
  liveTrendSources: number;
  seedTrendSources: number;
  uniqueTrendPlatforms: string[];
  supplyVerified: boolean;
  salesVerified: boolean;
  completeness: number;
  blockers: string[];
}

export interface OpportunityAnalysis {
  signal: string;
  hypothesis: string;
  decision: string;
  blockers: string[];
  nextBestAction: string;
}

export interface ProductOpportunity {
  id: string;
  eventName: string;
  market: string;
  category: string;
  demand: string;
  productName: string;
  reason: string;
  timeWindow: string;
  trendSignals: TrendSignal[];
  marketTrends?: MarketTrendPoint[];
  supply: SupplySignal;
  sales: SalesSignal;
  evidenceLinks: EvidenceLink[];
  validation: ValidationState;
  scores: OpportunityScores;
  evidence: OpportunityEvidence;
  analysis: OpportunityAnalysis;
  suggestedActions: string[];
  status: OpportunityStatus;
  feedbackHistory: FeedbackRecord[];
  businessOutcome?: BusinessOutcome;
  owner?: string;
  dueDate?: string;
  updatedAt: string;
}

export interface FeedbackAction {
  opportunityId: string;
  action: "useful" | "not_useful" | "follow_up" | "verifying" | "sampling" | "listed" | "rejected";
  note?: string;
  owner?: string;
  dueDate?: string;
  evidenceUrl?: string;
  outcome?: BusinessOutcome;
}

export interface ManualOpportunityInput {
  productName: string;
  market: string;
  category: string;
  eventName: string;
  demand: string;
  reason: string;
  timeWindow?: string;
  nextAction?: string;
}

export interface ManualOpportunityRecord extends ManualOpportunityInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface SourceStatus {
  name: string;
  ok: boolean;
  signalCount: number;
  lastCheckedAt: string;
  riskLevel?: "low" | "medium" | "high";
  error?: string;
}
