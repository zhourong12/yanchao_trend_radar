import type {
  CollectionChannelSummary,
  CollectionDashboard,
  FeedbackAction,
  ManualOpportunityInput,
  ProductOpportunity,
  SupplySignal
} from "../../shared/types";

export type CommerceIntegration = "taobao" | "1688";

export interface IntegrationAuthorizationStatus {
  configured: boolean;
  authorized: boolean;
  source: string;
  refreshAvailable: boolean;
  requiresAuthorization: boolean;
  proxyConfigured?: boolean;
  error?: string;
}

export async function fetchOpportunities(signal?: AbortSignal): Promise<ProductOpportunity[]> {
  return requestData<ProductOpportunity[]>("/api/opportunities?market=all&status=all", { signal }, "机会数据加载失败");
}

export async function fetchCollectionDashboard(signal?: AbortSignal): Promise<CollectionDashboard> {
  return requestData<CollectionDashboard>("/api/collections/today", { signal }, "今日采集台账获取失败");
}

export async function sendFeedback(payload: FeedbackAction) {
  await requestData<unknown>(
    "/api/feedback",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...feedbackHeaders() },
      body: JSON.stringify(payload)
    },
    "反馈提交失败"
  );
}

export function runCollectionRequest() {
  return requestData<{ dashboard: CollectionDashboard; opportunityCount: number }>(
    "/api/collections/run",
    { method: "POST", headers: adminHeaders() },
    "采集任务执行失败"
  );
}

export function testSourceRequest(sourceId: string) {
  return requestData<CollectionChannelSummary>(
    `/api/sources/${encodeURIComponent(sourceId)}/test`,
    { method: "POST", headers: adminHeaders() },
    "数据源连接测试失败"
  );
}

export function fetchIntegrationStatus(integration: CommerceIntegration, signal?: AbortSignal) {
  return requestData<IntegrationAuthorizationStatus>(
    `/api/integrations/${integration}/status`,
    { signal },
    `${integration === "taobao" ? "淘宝" : "1688"}授权状态读取失败`
  );
}

export function searchSupplyRequest(keyword: string) {
  return requestData<SupplySignal>(
    "/api/supply/search",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminHeaders() },
      body: JSON.stringify({ keyword, market: "CN" })
    },
    "供给搜索失败"
  );
}

export async function beginIntegrationAuthorization(integration: CommerceIntegration) {
  const data = await requestData<{ url?: string }>(
    `/api/integrations/${integration}/authorize-url`,
    { method: "POST", headers: adminHeaders() },
    "暂时无法发起平台授权"
  );
  if (!data.url) throw new Error("暂时无法发起平台授权，请稍后重试");
  window.location.assign(data.url);
}

export function createManualOpportunityRequest(input: ManualOpportunityInput) {
  return requestData<ProductOpportunity>(
    "/api/opportunities/manual",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...feedbackHeaders() },
      body: JSON.stringify(input)
    },
    "人工机会创建失败"
  );
}

export function presentBusinessError(value: unknown, fallback = "操作暂时未完成，请稍后重试") {
  const message = value instanceof Error ? value.message : typeof value === "string" ? value : "";
  if (!message) return fallback;
  if (/unauthori[sz]ed|forbidden|401|403|token|oauth|授权/i.test(message))
    return "账号授权已失效或权限不足，请重新授权";
  if (/timeout|timed out|abort/i.test(message)) return "平台响应超时，请稍后重试";
  if (/not configured|未配置|missing/i.test(message)) return "该数据源尚未完成配置";
  if (/rate limit|too many|429/i.test(message)) return "平台请求较多，请稍后重试";
  if (/\b5\d\d\b|http|api|endpoint|response|json|schema|network|fetch/i.test(message)) return fallback;
  return message;
}

async function requestData<T>(url: string, init: RequestInit, fallback: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new Error(presentBusinessError(error, fallback));
  }
  const payload = (await response.json().catch(() => ({}))) as { data?: T; error?: string };
  if (!response.ok || payload.data === undefined) {
    throw new Error(presentBusinessError(payload.error, fallback));
  }
  return payload.data;
}

function feedbackHeaders(): Record<string, string> {
  const token = window.sessionStorage.getItem("feedback-api-token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function adminHeaders() {
  return feedbackHeaders();
}
