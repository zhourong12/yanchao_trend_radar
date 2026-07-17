import { createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import dotenv from "dotenv";
import { z } from "zod";
import type { CollectionRecord, TrendSignal } from "../../shared/types";
import { mapHotTopicToProduct } from "./hotListAdapters";
import type { TrendSourceAdapter } from "./types";
import { isMysqlConfigured } from "../infrastructure/mysqlStore";
import { readIntegrationCredential, writeIntegrationCredential } from "../infrastructure/integrationCredentialStore";

const TAOBAO_GATEWAY = "https://api.taobao.global/rest";
const TAOBAO_AUTHORIZE_URL = "https://api.taobao.global/oauth/authorize";
const THEME_API = "/traffic/theme/getThemeDimList";
const TOKEN_CREATE_API = "/auth/token/create";
const TOKEN_REFRESH_API = "/auth/token/refresh";
const REQUEST_TIMEOUT_MS = 8_000;
const MAXIMUM_RESPONSE_BYTES = 2_000_000;
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_THEME_CONTENT_TYPES = ["15", "16", "17", "18", "19", "20", "21", "22"];

const marketByThemeContentType: Record<string, string> = {
  "11": "SEA",
  "12": "JP-KR",
  "13": "HK-MO-TW",
  "14": "LATAM",
  "15": "EU-US",
  "16": "HK",
  "17": "TW",
  "18": "SG",
  "19": "MY",
  "20": "TH",
  "21": "AU",
  "22": "KZ"
};

interface TaobaoGlobalCredentials {
  appKey: string;
  appSecret: string;
  accessToken: string;
}

interface TaobaoApplicationCredentials {
  appKey: string;
  appSecret: string;
}

const storedAuthorizationSchema = z.object({
  version: z.literal(1),
  appKey: z.string().min(1),
  accessToken: z.string().min(1).optional(),
  refreshToken: z.string().min(1).optional(),
  accessTokenExpiresAt: z.string().datetime().optional(),
  refreshTokenExpiresAt: z.string().datetime().optional(),
  authorizedAt: z.string().datetime().optional(),
  pendingState: z.string().min(32).optional(),
  pendingStateExpiresAt: z.string().datetime().optional()
});

type StoredAuthorization = z.infer<typeof storedAuthorizationSchema>;

export interface TaobaoAuthorizationStatus {
  configured: boolean;
  authorized: boolean;
  source: "stored_oauth" | "environment" | "legacy_environment" | "none";
  accessTokenExpiresAt?: string;
  refreshTokenExpiresAt?: string;
  refreshAvailable: boolean;
  requiresAuthorization: boolean;
  error?: string;
  lastCheckedAt?: string;
}

type TaobaoApiParams = Record<string, string>;
type UnknownRecord = Record<string, unknown>;

let latestCollectionRecords: CollectionRecord[] = [];
let latestAuthorizationFailure: { error: string; lastCheckedAt: string } | null = null;

export const taobaoThemeAdapter: TrendSourceAdapter = {
  name: "taobao-theme-discovery",
  type: "content",
  riskLevel: "low",
  async discoverSignals() {
    latestCollectionRecords = [];
    let credentials = await configuredCredentials();
    if (!credentials) return [];
    try {
      return await discoverThemeSignals(credentials);
    } catch (error) {
      if (error instanceof Error && isAuthorizationFailure(error)) {
        const refreshed = await refreshAfterAuthorizationFailure();
        if (refreshed) {
          credentials = refreshed;
          return discoverThemeSignals(credentials);
        }
        latestAuthorizationFailure = { error: error.message, lastCheckedAt: new Date().toISOString() };
      }
      throw error;
    }
  }
};

async function discoverThemeSignals(credentials: TaobaoGlobalCredentials) {
  const results = await Promise.allSettled(
    configuredThemeContentTypes().map((contentType) => fetchThemeDimension(contentType, credentials))
  );
  const fulfilled = results.filter(
    (result): result is PromiseFulfilledResult<{ records: CollectionRecord[]; signals: TrendSignal[] }> =>
      result.status === "fulfilled"
  );
  if (fulfilled.length === 0) {
    const firstFailure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    const error =
      firstFailure?.reason instanceof Error
        ? firstFailure.reason
        : new Error("Taobao Global Open theme collection failed");
    throw error;
  }
  latestAuthorizationFailure = null;
  latestCollectionRecords = fulfilled.flatMap((result) => result.value.records);
  return dedupeSignals(fulfilled.flatMap((result) => result.value.signals));
}

async function refreshAfterAuthorizationFailure(): Promise<TaobaoGlobalCredentials | null> {
  const application = configuredApplication();
  if (!application) return null;
  const stored = await readStoredAuthorization(application.appKey);
  if (!stored.refreshToken) return null;
  try {
    const refreshed = await refreshStoredAuthorization(application, stored);
    return refreshed.accessToken ? { ...application, accessToken: refreshed.accessToken } : null;
  } catch {
    return null;
  }
}

export function getTaobaoThemeCollectionRecords() {
  return latestCollectionRecords;
}

export function createTaobaoSignature(apiName: string, params: TaobaoApiParams, appSecret: string) {
  const payload =
    apiName +
    Object.keys(params)
      .sort()
      .map((key) => `${key}${params[key]}`)
      .join("");
  return createHmac("sha256", appSecret).update(payload).digest("hex").toUpperCase();
}

export async function createTaobaoAuthorizationUrl(redirectUri: string) {
  const application = configuredApplication();
  if (!application) throw new Error("Taobao Global Open AppKey/AppSecret is not configured");
  const parsedRedirect = validateRedirectUri(redirectUri);
  const state = randomBytes(32).toString("hex");
  await writeStoredAuthorization({
    ...(await readStoredAuthorization(application.appKey)),
    version: 1,
    appKey: application.appKey,
    pendingState: state,
    pendingStateExpiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString()
  });
  const url = new URL(TAOBAO_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", parsedRedirect.toString());
  url.searchParams.set("force_auth", "true");
  url.searchParams.set("client_id", application.appKey);
  url.searchParams.set("state", state);
  return url.toString();
}

export async function completeTaobaoAuthorization(code: string, state: string) {
  const application = configuredApplication();
  if (!application) throw new Error("Taobao Global Open AppKey/AppSecret is not configured");
  const stored = await readStoredAuthorization(application.appKey);
  if (
    !stored.pendingState ||
    stored.pendingState !== state ||
    !stored.pendingStateExpiresAt ||
    Date.parse(stored.pendingStateExpiresAt) <= Date.now()
  ) {
    throw new Error("Taobao OAuth state is invalid or expired; restart authorization");
  }
  const payload = await executeTaobaoRequest(TOKEN_CREATE_API, { code }, application);
  await saveTokenResponse(application.appKey, payload, stored);
  latestAuthorizationFailure = null;
  return getTaobaoAuthorizationStatus();
}

export async function getTaobaoAuthorizationStatus(): Promise<TaobaoAuthorizationStatus> {
  const application = configuredApplication();
  if (!application) {
    return {
      configured: false,
      authorized: false,
      source: "none",
      refreshAvailable: false,
      requiresAuthorization: true
    };
  }
  const stored = await readStoredAuthorization(application.appKey);
  if (latestAuthorizationFailure) {
    return {
      configured: true,
      authorized: false,
      source: stored.accessToken
        ? "stored_oauth"
        : process.env.TAOBAO_GLOBAL_OPEN_TOKEN
          ? "environment"
          : "legacy_environment",
      accessTokenExpiresAt: stored.accessTokenExpiresAt,
      refreshTokenExpiresAt: stored.refreshTokenExpiresAt,
      refreshAvailable: false,
      requiresAuthorization: true,
      ...latestAuthorizationFailure
    };
  }
  if (stored.accessToken) {
    const accessTokenValid = !stored.accessTokenExpiresAt || Date.parse(stored.accessTokenExpiresAt) > Date.now();
    const refreshAvailable = Boolean(
      stored.refreshToken && (!stored.refreshTokenExpiresAt || Date.parse(stored.refreshTokenExpiresAt) > Date.now())
    );
    return {
      configured: true,
      authorized: accessTokenValid || refreshAvailable,
      source: "stored_oauth",
      accessTokenExpiresAt: stored.accessTokenExpiresAt,
      refreshTokenExpiresAt: stored.refreshTokenExpiresAt,
      refreshAvailable,
      requiresAuthorization: !accessTokenValid && !refreshAvailable
    };
  }
  const legacy = readLegacyEnvironment();
  const directToken = process.env.TAOBAO_GLOBAL_OPEN_TOKEN;
  const legacyToken = legacy.TAOBAO_GLOBAL_OPEN_TOKEN;
  return {
    configured: true,
    authorized: Boolean(directToken || legacyToken),
    source: directToken ? "environment" : legacyToken ? "legacy_environment" : "none",
    refreshAvailable: false,
    requiresAuthorization: !directToken && !legacyToken
  };
}

function isAuthorizationFailure(error: Error) {
  return /IllegalAccessToken|access token.*(?:invalid|expired)|unauthori[sz]ed/i.test(error.message);
}

async function fetchThemeDimension(contentType: string, credentials: TaobaoGlobalCredentials) {
  const apiParams: TaobaoApiParams = {
    theme_channel_type: process.env.TAOBAO_THEME_CHANNEL_TYPE ?? "1",
    theme_content_type: contentType,
    page_no: "1",
    page_size: "20"
  };
  const categoryIds = configuredCategoryIds();
  if (categoryIds.length > 0) apiParams.cate_id_list = JSON.stringify(categoryIds);
  const payload = await executeTaobaoRequest(THEME_API, apiParams, credentials);
  const themes = extractThemeItems(payload);
  const collectedAt = new Date().toISOString();
  const market = marketByThemeContentType[contentType] ?? `THEME-${contentType}`;
  const records: CollectionRecord[] = [];
  const signals: TrendSignal[] = [];
  themes.forEach((theme, index) => {
    const title = themeTitle(theme);
    if (!title) return;
    const mapped = mapHotTopicToProduct(title);
    const id = `taobao-theme-${contentType}-${themeId(theme) ?? hashTitle(title)}`;
    records.push({
      id,
      channel: "taobao-theme-discovery",
      platform: "taobao-global-theme",
      market,
      title,
      collectedAt,
      observedAt: collectedAt,
      metricLabel: "主题排名",
      metricValue: index + 1,
      rank: index + 1,
      outcome: mapped ? "mapped" : "filtered",
      enteredAnalysis: Boolean(mapped),
      mappedKeyword: mapped?.keyword,
      category: mapped?.category,
      mappingConfidence: mapped?.confidence,
      reason: mapped ? "淘宝官方主题命中商品场景规则，已进入机会分析。" : "淘宝官方主题已采集，暂未命中商品意图规则。",
      origin: "live"
    });
    if (!mapped) return;
    const currentIndex = Math.max(30, 100 - index * 3);
    signals.push({
      id,
      source: "Taobao Global Open theme",
      origin: "live",
      sourceKind: "official",
      sourceRisk: "low",
      retrievedAt: collectedAt,
      methodology: `Official Taobao Global Open ${THEME_API}; theme_channel_type=${apiParams.theme_channel_type}, theme_content_type=${contentType}.`,
      platformType: "content",
      keyword: mapped.keyword,
      market,
      category: mapped.category,
      observedAt: collectedAt,
      currentIndex,
      baselineIndex: currentIndex,
      growthRate: 0,
      confidence: Math.min(0.9, mapped.confidence + 0.1),
      evidence: `Taobao Global Open theme "${title}" for content type ${contentType}.`,
      sourcePlatform: "taobao-global-theme",
      sourceTopic: title,
      mappingConfidence: mapped.confidence
    });
  });
  return { records, signals };
}

async function executeTaobaoRequest(
  apiName: string,
  apiParams: TaobaoApiParams,
  credentials: TaobaoApplicationCredentials & { accessToken?: string }
) {
  const gateway = process.env.TAOBAO_GLOBAL_OPEN_GATEWAY ?? TAOBAO_GATEWAY;
  const url = new URL(`${gateway.replace(/\/+$/, "")}${apiName}`);
  if (url.protocol !== "https:" || url.hostname !== "api.taobao.global") {
    throw new Error("TAOBAO_GLOBAL_OPEN_GATEWAY must use https://api.taobao.global");
  }
  const systemParams: TaobaoApiParams = {
    app_key: credentials.appKey,
    sign_method: "sha256",
    timestamp: `${Math.floor(Date.now() / 1000)}000`,
    partner_id: "iop-sdk-php-20200227"
  };
  if (credentials.accessToken) systemParams.access_token = credentials.accessToken;
  systemParams.sign = createTaobaoSignature(apiName, { ...apiParams, ...systemParams }, credentials.appSecret);
  Object.entries(systemParams).forEach(([key, value]) => url.searchParams.set(key, value));
  const form = new FormData();
  Object.entries(apiParams).forEach(([key, value]) => form.set(key, value));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      body: form,
      headers: { "User-Agent": "iop-sdk-php-20200227" },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Taobao Global Open HTTP ${response.status}`);
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > MAXIMUM_RESPONSE_BYTES) {
      throw new Error("Taobao Global Open response exceeded 2 MB");
    }
    const payload = JSON.parse(body) as UnknownRecord;
    const code = payload.code;
    if (code !== undefined && code !== null && code !== 0 && code !== "0") {
      const message = stringValue(payload.message ?? payload.biz_error_msg) || "unknown error";
      throw new Error(`Taobao Global Open ${String(code)}: ${message}`);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function configuredCredentials(): Promise<TaobaoGlobalCredentials | null> {
  const application = configuredApplication();
  if (!application) return null;
  let stored = await readStoredAuthorization(application.appKey);
  if (stored.accessToken) {
    const expiresAt = stored.accessTokenExpiresAt ? Date.parse(stored.accessTokenExpiresAt) : Number.POSITIVE_INFINITY;
    if (expiresAt <= Date.now() + TOKEN_REFRESH_BUFFER_MS) {
      stored = await refreshStoredAuthorization(application, stored);
    }
    if (stored.accessToken && (!stored.accessTokenExpiresAt || Date.parse(stored.accessTokenExpiresAt) > Date.now())) {
      return { ...application, accessToken: stored.accessToken };
    }
  }
  const legacy = readLegacyEnvironment();
  const accessToken = process.env.TAOBAO_GLOBAL_OPEN_TOKEN ?? legacy.TAOBAO_GLOBAL_OPEN_TOKEN;
  return accessToken ? { ...application, accessToken } : null;
}

function configuredApplication(): TaobaoApplicationCredentials | null {
  const legacy = readLegacyEnvironment();
  const appKey = process.env.TAOBAO_GLOBAL_OPEN_APPKEY ?? legacy.TAOBAO_GLOBAL_OPEN_APPKEY;
  const appSecret = process.env.TAOBAO_GLOBAL_OPEN_APPSECRET ?? legacy.TAOBAO_GLOBAL_OPEN_APPSECRET;
  return appKey && appSecret ? { appKey, appSecret } : null;
}

function readLegacyEnvironment() {
  const path = process.env.TAOBAO_LEGACY_ENV_PATH;
  if (!path || !existsSync(path)) return {} as Record<string, string>;
  return dotenv.parse(readFileSync(path));
}

async function refreshStoredAuthorization(
  application: TaobaoApplicationCredentials,
  stored: StoredAuthorization
): Promise<StoredAuthorization> {
  const refreshValid = Boolean(
    stored.refreshToken && (!stored.refreshTokenExpiresAt || Date.parse(stored.refreshTokenExpiresAt) > Date.now())
  );
  if (!stored.refreshToken || !refreshValid) return stored;
  const payload = await executeTaobaoRequest(TOKEN_REFRESH_API, { refresh_token: stored.refreshToken }, application);
  return saveTokenResponse(application.appKey, payload, stored);
}

async function saveTokenResponse(appKey: string, payload: UnknownRecord, previous: StoredAuthorization) {
  const accessToken = stringValue(payload.access_token);
  if (!accessToken) throw new Error("Taobao OAuth response did not include access_token");
  const refreshToken = stringValue(payload.refresh_token) || previous.refreshToken;
  const expiresIn = positiveNumber(payload.expires_in);
  const refreshExpiresIn = positiveNumber(payload.refresh_expires_in);
  const next: StoredAuthorization = {
    version: 1,
    appKey,
    accessToken,
    refreshToken,
    accessTokenExpiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : undefined,
    refreshTokenExpiresAt: refreshExpiresIn
      ? new Date(Date.now() + refreshExpiresIn * 1000).toISOString()
      : previous.refreshTokenExpiresAt,
    authorizedAt: new Date().toISOString()
  };
  await writeStoredAuthorization(next);
  return next;
}

function authorizationPath() {
  return process.env.TAOBAO_AUTH_STATE_PATH
    ? resolve(process.env.TAOBAO_AUTH_STATE_PATH)
    : join(process.cwd(), "data", "taobao-global-auth.json");
}

async function readStoredAuthorization(appKey: string): Promise<StoredAuthorization> {
  if (isMysqlConfigured()) {
    const stored = await readIntegrationCredential<StoredAuthorization>("taobao", appKey);
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
        event: "taobao_authorization_store_invalid",
        path,
        error: error instanceof Error ? error.message : String(error)
      })
    );
    return { version: 1, appKey };
  }
}

async function writeStoredAuthorization(authorization: StoredAuthorization) {
  if (isMysqlConfigured()) {
    await writeIntegrationCredential("taobao", authorization.appKey, storedAuthorizationSchema.parse(authorization));
    return;
  }
  const path = authorizationPath();
  const validated = storedAuthorizationSchema.parse(authorization);
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(validated, null, 2), { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, path);
}

function validateRedirectUri(value: string) {
  const parsed = new URL(value);
  const isLocal = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  if (
    parsed.protocol !== "https:" &&
    !(process.env.NODE_ENV !== "production" && isLocal && parsed.protocol === "http:")
  ) {
    throw new Error("Taobao OAuth redirect URI must use HTTPS outside local development");
  }
  return parsed;
}

function positiveNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function configuredThemeContentTypes() {
  const configured = process.env.TAOBAO_THEME_CONTENT_TYPES?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set(configured?.length ? configured : DEFAULT_THEME_CONTENT_TYPES)];
}

function configuredCategoryIds() {
  return (
    process.env.TAOBAO_THEME_CATEGORY_IDS?.split(",")
      .map((item) => item.trim())
      .filter(Boolean) ?? []
  );
}

function extractThemeItems(payload: UnknownRecord) {
  const arrays: UnknownRecord[][] = [];
  collectObjectArrays(payload.data ?? payload, arrays, 0);
  return arrays.sort((a, b) => b.length - a.length)[0] ?? [];
}

function collectObjectArrays(value: unknown, arrays: UnknownRecord[][], depth: number) {
  if (depth > 6 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    const objects = value.filter((item): item is UnknownRecord => Boolean(item && typeof item === "object"));
    if (objects.some((item) => Boolean(themeTitle(item)))) arrays.push(objects);
    value.forEach((item) => collectObjectArrays(item, arrays, depth + 1));
    return;
  }
  if (typeof value === "object") {
    Object.values(value as UnknownRecord).forEach((item) => collectObjectArrays(item, arrays, depth + 1));
  }
}

function themeTitle(theme: UnknownRecord) {
  return stringValue(
    theme.theme_name ?? theme.themeName ?? theme.theme_title ?? theme.themeTitle ?? theme.title ?? theme.name
  );
}

function themeId(theme: UnknownRecord) {
  const value = theme.theme_id ?? theme.themeId ?? theme.id;
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function dedupeSignals(signals: TrendSignal[]) {
  const seen = new Set<string>();
  return signals.filter((signal) => {
    const key = `${signal.market}:${signal.keyword}:${signal.sourceTopic}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hashTitle(title: string) {
  let hash = 0;
  for (let index = 0; index < title.length; index += 1) hash = (hash * 31 + title.charCodeAt(index)) >>> 0;
  return hash.toString(36);
}
