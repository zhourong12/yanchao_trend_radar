import { createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import type { CollectionRecord, SupplySignal } from "../../shared/types";
import { isMysqlConfigured } from "../infrastructure/mysqlStore";
import { readIntegrationCredential, writeIntegrationCredential } from "../infrastructure/integrationCredentialStore";

const API_BASE_URL = "https://gw.open.1688.com/openapi";
const AUTHORIZE_URL = "https://auth.1688.com/oauth/authorize";
const API_NAMESPACE = "com.alibaba.fenxiao.crossborder";
const SEARCH_API = "product.search.keywordQuery";
const REQUEST_TIMEOUT_MS = 10_000;
const MAXIMUM_RESPONSE_BYTES = 2_000_000;
const TOKEN_REFRESH_BUFFER_MS = 5 * 60_000;
const OAUTH_STATE_TTL_MS = 10 * 60_000;

const offerSchema = z
  .object({
    offerId: z.union([z.string(), z.number()]),
    subject: z.string().optional(),
    subjectTrans: z.string().optional(),
    imageUrl: z.string().optional(),
    monthSold: z.union([z.string(), z.number()]).optional(),
    sellerOpenId: z.string().optional(),
    traceInfo: z.string().optional(),
    repurchaseRate: z.union([z.string(), z.number()]).optional(),
    priceInfo: z
      .object({
        price: z.union([z.string(), z.number()]).optional(),
        consignPrice: z.union([z.string(), z.number()]).optional()
      })
      .optional()
  })
  .passthrough();

const searchResponseSchema = z
  .object({
    result: z
      .object({
        success: z.boolean().optional(),
        message: z.string().optional(),
        result: z
          .object({
            data: z.array(offerSchema).optional(),
            totalRecords: z.union([z.string(), z.number()]).optional()
          })
          .optional()
      })
      .optional(),
    errorMessage: z.string().optional(),
    errorCode: z.string().optional()
  })
  .passthrough();

interface Alibaba1688Credentials {
  appKey: string;
  appSecret: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  proxy?: string;
}

interface Alibaba1688ApplicationCredentials {
  appKey: string;
  appSecret: string;
  proxy?: string;
}

const storedAuthorizationSchema = z.object({
  version: z.literal(1),
  appKey: z.string().min(1),
  accessToken: z.string().min(1).optional(),
  refreshToken: z.string().min(1).optional(),
  accessTokenExpiresAt: z.string().datetime().optional(),
  refreshTokenExpiresAt: z.string().datetime().optional(),
  resourceOwner: z.string().optional(),
  aliId: z.string().optional(),
  memberId: z.string().optional(),
  authorizedAt: z.string().datetime().optional(),
  pendingState: z.string().min(32).optional(),
  pendingStateExpiresAt: z.string().datetime().optional()
});

type StoredAuthorization = z.infer<typeof storedAuthorizationSchema>;

export interface Alibaba1688AuthorizationStatus {
  configured: boolean;
  authorized: boolean;
  source: "stored_oauth" | "environment" | "none";
  accessTokenExpiresAt?: string;
  refreshTokenExpiresAt?: string;
  refreshAvailable: boolean;
  requiresAuthorization: boolean;
  owner?: string;
  proxyConfigured: boolean;
  error?: string;
  lastCheckedAt?: string;
}

interface Alibaba1688CollectionState {
  configured: boolean;
  ok: boolean;
  lastCheckedAt?: string;
  error?: string;
  records: CollectionRecord[];
}

let runtimeAccessToken: string | undefined;
let runtimeExpiresAt: number | undefined;
let proxyAgent: ProxyAgent | undefined;
let proxyAgentUrl: string | undefined;
let collectionState: Alibaba1688CollectionState = { configured: false, ok: false, records: [] };
let latestAuthorizationFailure: { error: string; lastCheckedAt: string } | null = null;

export async function fetchAlibaba1688Supply(keyword: string, market: string): Promise<SupplySignal | null> {
  const configured = await configuredCredentials();
  if (!configured) {
    const authorization = await getAlibaba1688AuthorizationStatus();
    collectionState = {
      configured: authorization.configured,
      ok: false,
      error: authorization.configured
        ? "1688 application is configured, but account authorization is required"
        : "1688 Global Open AppKey/AppSecret is not configured",
      records: collectionState.records
    };
    latestAuthorizationFailure = null;
    return null;
  }
  const checkedAt = new Date().toISOString();
  try {
    const credentials = await ensureFreshCredentials(configured);
    const payload = await search1688(keyword, credentials);
    const parsed = searchResponseSchema.parse(payload);
    if (parsed.result?.success === false || !parsed.result?.result) {
      throw new Error(parsed.result?.message ?? parsed.errorMessage ?? "1688 product search returned no result");
    }
    const offers = parsed.result.result.data ?? [];
    if (offers.length === 0) throw new Error("1688 product search returned no offers");
    const prices = offers
      .map((offer) => numberValue(offer.priceInfo?.price ?? offer.priceInfo?.consignPrice))
      .filter((value): value is number => value !== undefined && value >= 0);
    const suppliers = new Set(
      offers.map((offer) => offer.sellerOpenId ?? offer.traceInfo).filter((value): value is string => Boolean(value))
    );
    const records = offers.map((offer, index) => offerToCollectionRecord(offer, keyword, market, checkedAt, index));
    collectionState = {
      configured: true,
      ok: true,
      lastCheckedAt: checkedAt,
      records: mergeRecords(collectionState.records, records)
    };
    return {
      productName: keyword,
      origin: "live",
      sourceKind: "official",
      sourceRisk: "low",
      supplierCount: suppliers.size || offers.length,
      supplierCountIsSample: true,
      sampleSize: offers.length,
      minPriceCny: prices.length > 0 ? Math.min(...prices) : 0,
      maxPriceCny: prices.length > 0 ? Math.max(...prices) : 0,
      moq: 0,
      leadTimeDays: 0,
      complianceTags: ["1688 Global Open", `${offers.length}条实时供给样本`, "MOQ与交期需商品详情二次验证"],
      sourceUrl: `https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(keyword)}`
    };
  } catch (error) {
    if (isAuthorizationFailure(error)) {
      latestAuthorizationFailure = {
        error: error instanceof Error ? error.message : String(error),
        lastCheckedAt: checkedAt
      };
    }
    collectionState = {
      configured: true,
      ok: false,
      lastCheckedAt: checkedAt,
      error: error instanceof Error ? error.message : String(error),
      records: collectionState.records
    };
    throw error;
  }
}

export function getAlibaba1688CollectionState() {
  return collectionState;
}

export async function getAlibaba1688AuthorizationStatus(): Promise<Alibaba1688AuthorizationStatus> {
  const application = configuredApplication();
  if (!application) {
    return {
      configured: false,
      authorized: false,
      source: "none",
      refreshAvailable: false,
      requiresAuthorization: true,
      proxyConfigured: false
    };
  }
  const stored = await readStoredAuthorization(application.appKey);
  const environmentAccessToken = process.env.ALIBABA_1688_ACCESS_TOKEN;
  const accessTokenExpiresAt = stored.accessTokenExpiresAt ?? process.env.ALIBABA_1688_ACCESS_TOKEN_EXPIRES_AT;
  const refreshTokenExpiresAt = stored.refreshTokenExpiresAt;
  const hasAccessToken = Boolean(stored.accessToken || environmentAccessToken);
  const accessTokenValid = Boolean(
    hasAccessToken && (!accessTokenExpiresAt || Date.parse(accessTokenExpiresAt) > Date.now())
  );
  const refreshToken = stored.refreshToken ?? process.env.ALIBABA_1688_REFRESH_TOKEN;
  const refreshAvailable = Boolean(
    refreshToken && (!refreshTokenExpiresAt || Date.parse(refreshTokenExpiresAt) > Date.now())
  );
  const base = {
    configured: true,
    authorized: accessTokenValid || refreshAvailable,
    source: stored.accessToken
      ? ("stored_oauth" as const)
      : environmentAccessToken
        ? ("environment" as const)
        : ("none" as const),
    accessTokenExpiresAt,
    refreshTokenExpiresAt,
    refreshAvailable,
    requiresAuthorization: !accessTokenValid && !refreshAvailable,
    owner: stored.resourceOwner,
    proxyConfigured: Boolean(application.proxy)
  };
  return latestAuthorizationFailure
    ? { ...base, authorized: false, requiresAuthorization: true, ...latestAuthorizationFailure }
    : base;
}

export async function createAlibaba1688AuthorizationUrl(redirectUri: string) {
  const application = configuredApplication();
  if (!application) throw new Error("1688 Global Open AppKey/AppSecret is not configured");
  const parsedRedirect = validateRedirectUri(redirectUri);
  const state = randomBytes(32).toString("hex");
  await writeStoredAuthorization({
    ...(await readStoredAuthorization(application.appKey)),
    version: 1,
    appKey: application.appKey,
    pendingState: state,
    pendingStateExpiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString()
  });
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", application.appKey);
  url.searchParams.set("site", "1688");
  url.searchParams.set("redirect_uri", parsedRedirect.toString());
  url.searchParams.set("state", state);
  return url.toString();
}

export async function completeAlibaba1688Authorization(code: string, state: string) {
  const application = configuredApplication();
  if (!application) throw new Error("1688 Global Open AppKey/AppSecret is not configured");
  const stored = await readStoredAuthorization(application.appKey);
  if (
    !stored.pendingState ||
    stored.pendingState !== state ||
    !stored.pendingStateExpiresAt ||
    Date.parse(stored.pendingStateExpiresAt) <= Date.now()
  ) {
    throw new Error("1688 OAuth state is invalid or expired; restart authorization");
  }
  const url = new URL(`${API_BASE_URL}/http/1/system.oauth2/getToken/${application.appKey}`);
  url.searchParams.set("grant_type", "authorization_code");
  url.searchParams.set("need_refresh_token", "true");
  url.searchParams.set("client_id", application.appKey);
  url.searchParams.set("client_secret", application.appSecret);
  url.searchParams.set("code", code);
  const payload = await fetchJson(url, "POST", application.proxy);
  await saveAuthorizationPayload(application.appKey, payload, stored);
  latestAuthorizationFailure = null;
  return getAlibaba1688AuthorizationStatus();
}

export function createAlibaba1688Signature(apiInfo: string, parameters: Record<string, string>, appSecret: string) {
  const payload =
    apiInfo +
    Object.keys(parameters)
      .sort()
      .map((key) => `${key}${parameters[key]}`)
      .join("");
  return createHmac("sha1", appSecret).update(payload).digest("hex").toUpperCase();
}

async function search1688(keyword: string, credentials: Alibaba1688Credentials) {
  const apiInfo = `param2/1/${API_NAMESPACE}/${SEARCH_API}/${credentials.appKey}`;
  const parameters: Record<string, string> = {
    offerQueryParam: JSON.stringify({ keyword, beginPage: 1, pageSize: 20, country: "en" }),
    access_token: credentials.accessToken,
    language: "en"
  };
  parameters._aop_signature = createAlibaba1688Signature(apiInfo, parameters, credentials.appSecret);
  const url = new URL(`${API_BASE_URL}/${apiInfo}`);
  Object.entries(parameters).forEach(([key, value]) => url.searchParams.set(key, value));
  return fetchJson(url, "GET", credentials.proxy);
}

async function ensureFreshCredentials(credentials: Alibaba1688Credentials) {
  const accessToken = runtimeAccessToken ?? credentials.accessToken;
  const expiresAt = runtimeExpiresAt ?? credentials.expiresAt;
  if (!expiresAt || expiresAt > Date.now() + TOKEN_REFRESH_BUFFER_MS) return { ...credentials, accessToken };
  if (!credentials.refreshToken) throw new Error("1688 access token has expired and no refresh token is configured");
  const refreshed = await refreshAccessToken(credentials);
  runtimeAccessToken = refreshed.accessToken;
  runtimeExpiresAt = refreshed.expiresAt;
  return { ...credentials, accessToken: refreshed.accessToken, expiresAt: refreshed.expiresAt };
}

async function refreshAccessToken(credentials: Alibaba1688Credentials) {
  const url = new URL(`${API_BASE_URL}/param2/1/system.oauth2/getToken/${credentials.appKey}`);
  url.searchParams.set("grant_type", "refresh_token");
  url.searchParams.set("client_id", credentials.appKey);
  url.searchParams.set("client_secret", credentials.appSecret);
  url.searchParams.set("refresh_token", credentials.refreshToken ?? "");
  const payload = await fetchJson(url, "POST", credentials.proxy);
  const accessToken = typeof payload.access_token === "string" ? payload.access_token : undefined;
  const expiresIn = numberValue(payload.expires_in);
  if (!accessToken) {
    const message = typeof payload.error_description === "string" ? payload.error_description : "refresh failed";
    throw new Error(`1688 access token refresh failed: ${message}`);
  }
  const expiresAt = Date.now() + (expiresIn ?? 3600) * 1000;
  const application = configuredApplication();
  if (application) {
    await saveAuthorizationPayload(application.appKey, payload, await readStoredAuthorization(application.appKey));
  }
  return { accessToken, expiresAt };
}

async function fetchJson(url: URL, method: "GET" | "POST" = "GET", proxy?: string) {
  if (url.protocol !== "https:" || url.hostname !== "gw.open.1688.com") {
    throw new Error("1688 requests must use https://gw.open.1688.com");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await undiciFetch(url, {
      method,
      headers: { Accept: "application/json", "User-Agent": "yanchao-opportunity-radar/0.2" },
      signal: controller.signal,
      dispatcher: proxy ? configuredProxyAgent(proxy) : undefined
    });
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > MAXIMUM_RESPONSE_BYTES) throw new Error("1688 response exceeded 2 MB");
    const payload = JSON.parse(body) as Record<string, unknown>;
    if (!response.ok) {
      const message = safeErrorMessage(payload);
      throw new Error(`1688 Global Open HTTP ${response.status}${message ? `: ${message}` : ""}`);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function safeErrorMessage(payload: Record<string, unknown>) {
  for (const key of ["error_description", "errorMessage", "message", "error_message", "error"]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 300);
  }
  return "";
}

async function configuredCredentials(): Promise<Alibaba1688Credentials | null> {
  const application = configuredApplication();
  if (!application) return null;
  const stored = await readStoredAuthorization(application.appKey);
  const accessToken = runtimeAccessToken || stored.accessToken || process.env.ALIBABA_1688_ACCESS_TOKEN;
  if (!accessToken) return null;
  const expiresAtText = stored.accessTokenExpiresAt || process.env.ALIBABA_1688_ACCESS_TOKEN_EXPIRES_AT;
  const expiresAt = expiresAtText ? new Date(expiresAtText).getTime() : undefined;
  return {
    ...application,
    accessToken,
    refreshToken: stored.refreshToken || process.env.ALIBABA_1688_REFRESH_TOKEN,
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : undefined
  };
}

function configuredApplication(): Alibaba1688ApplicationCredentials | null {
  const appKey = process.env.ALIBABA_1688_APPKEY;
  const appSecret = process.env.ALIBABA_1688_APPSECRET;
  return appKey && appSecret ? { appKey, appSecret, proxy: process.env.ALIBABA_1688_PROXY || undefined } : null;
}

function configuredProxyAgent(value: string) {
  const normalized = /^https?:\/\//i.test(value) ? value : `http://${value}`;
  const url = new URL(normalized);
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname) throw new Error("Invalid 1688 proxy configuration");
  if (!proxyAgent || proxyAgentUrl !== url.toString()) {
    proxyAgent = new ProxyAgent(url.toString());
    proxyAgentUrl = url.toString();
  }
  return proxyAgent;
}

function authorizationPath() {
  return process.env.ALIBABA_1688_AUTH_STATE_PATH
    ? resolve(process.env.ALIBABA_1688_AUTH_STATE_PATH)
    : join(process.cwd(), "data", "alibaba-1688-auth.json");
}

async function readStoredAuthorization(appKey: string): Promise<StoredAuthorization> {
  if (isMysqlConfigured()) {
    const stored = await readIntegrationCredential<StoredAuthorization>("1688", appKey);
    return stored ? storedAuthorizationSchema.parse(stored) : { version: 1, appKey };
  }
  const path = authorizationPath();
  if (!existsSync(path)) return { version: 1, appKey };
  try {
    const stored = storedAuthorizationSchema.parse(JSON.parse(readFileSync(path, "utf8")) as unknown);
    return stored.appKey === appKey ? stored : { version: 1, appKey };
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "alibaba_1688_authorization_store_invalid",
        path,
        error: error instanceof Error ? error.message : String(error)
      })
    );
    return { version: 1, appKey };
  }
}

async function writeStoredAuthorization(authorization: StoredAuthorization) {
  if (isMysqlConfigured()) {
    await writeIntegrationCredential("1688", authorization.appKey, storedAuthorizationSchema.parse(authorization));
    return;
  }
  const path = authorizationPath();
  const validated = storedAuthorizationSchema.parse(authorization);
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(validated, null, 2), { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, path);
}

async function saveAuthorizationPayload(
  appKey: string,
  payload: Record<string, unknown>,
  previous: StoredAuthorization
) {
  const accessToken = stringValue(payload.access_token);
  if (!accessToken) throw new Error("1688 OAuth response did not include access_token");
  const refreshToken = stringValue(payload.refresh_token) || previous.refreshToken;
  const expiresIn = numberValue(payload.expires_in);
  const refreshTokenTimeout = parseAlibabaDate(payload.refresh_token_timeout);
  const next: StoredAuthorization = {
    version: 1,
    appKey,
    accessToken,
    refreshToken,
    accessTokenExpiresAt: new Date(Date.now() + (expiresIn ?? 3600) * 1000).toISOString(),
    refreshTokenExpiresAt: refreshTokenTimeout ?? previous.refreshTokenExpiresAt,
    resourceOwner: stringValue(payload.resource_owner) || previous.resourceOwner,
    aliId: stringValue(payload.aliId) || previous.aliId,
    memberId: stringValue(payload.memberId) || previous.memberId,
    authorizedAt: new Date().toISOString()
  };
  runtimeAccessToken = accessToken;
  runtimeExpiresAt = Date.parse(next.accessTokenExpiresAt!);
  await writeStoredAuthorization(next);
  return next;
}

function parseAlibabaDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  const match = value.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (!match) return undefined;
  return new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`).toISOString();
}

function validateRedirectUri(value: string) {
  const parsed = new URL(value);
  const isLocal = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  if (
    parsed.protocol !== "https:" &&
    !(process.env.NODE_ENV !== "production" && isLocal && parsed.protocol === "http:")
  ) {
    throw new Error("1688 OAuth redirect URI must use HTTPS outside local development");
  }
  return parsed;
}

function isAuthorizationFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /access.?token|authorize|oauth|invalid.?signature|permission/i.test(message);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function offerToCollectionRecord(
  offer: z.infer<typeof offerSchema>,
  keyword: string,
  market: string,
  collectedAt: string,
  index: number
): CollectionRecord {
  const offerId = String(offer.offerId);
  const price = numberValue(offer.priceInfo?.price ?? offer.priceInfo?.consignPrice);
  const monthSold = numberValue(offer.monthSold);
  return {
    id: `1688-${offerId}`,
    channel: "1688-supply-live",
    platform: "1688",
    market,
    title: offer.subjectTrans ?? offer.subject ?? `1688 offer ${offerId}`,
    collectedAt,
    observedAt: collectedAt,
    metricLabel: monthSold !== undefined ? "月销" : "供货价",
    metricValue: monthSold ?? price,
    rank: index + 1,
    sourceUrl: `https://detail.1688.com/offer/${offerId}.html`,
    outcome: "validation",
    enteredAnalysis: false,
    mappedKeyword: keyword,
    reason: `1688 官方商品样本${price !== undefined ? `，供货价 ¥${price}` : ""}${monthSold !== undefined ? `，月销 ${monthSold}` : ""}。`,
    origin: "live"
  };
}

function mergeRecords(previous: CollectionRecord[], next: CollectionRecord[]) {
  const records = new Map(previous.map((record) => [`${record.market}:${record.id}`, record]));
  next.forEach((record) => records.set(`${record.market}:${record.id}`, record));
  return [...records.values()].slice(-300);
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
