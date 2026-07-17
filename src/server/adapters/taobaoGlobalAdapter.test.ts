import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  completeTaobaoAuthorization,
  createTaobaoAuthorizationUrl,
  createTaobaoSignature,
  getTaobaoAuthorizationStatus,
  taobaoThemeAdapter
} from "./taobaoGlobalAdapter";

const originalEnvironment = {
  appKey: process.env.TAOBAO_GLOBAL_OPEN_APPKEY,
  appSecret: process.env.TAOBAO_GLOBAL_OPEN_APPSECRET,
  statePath: process.env.TAOBAO_AUTH_STATE_PATH,
  token: process.env.TAOBAO_GLOBAL_OPEN_TOKEN,
  legacyPath: process.env.TAOBAO_LEGACY_ENV_PATH
};
const temporaryDirectories: string[] = [];

afterEach(() => {
  restoreEnvironment("TAOBAO_GLOBAL_OPEN_APPKEY", originalEnvironment.appKey);
  restoreEnvironment("TAOBAO_GLOBAL_OPEN_APPSECRET", originalEnvironment.appSecret);
  restoreEnvironment("TAOBAO_AUTH_STATE_PATH", originalEnvironment.statePath);
  restoreEnvironment("TAOBAO_GLOBAL_OPEN_TOKEN", originalEnvironment.token);
  restoreEnvironment("TAOBAO_LEGACY_ENV_PATH", originalEnvironment.legacyPath);
  temporaryDirectories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }));
  vi.restoreAllMocks();
});

describe("Taobao Global Open signing", () => {
  it("uses deterministic, order-independent uppercase HMAC-SHA256 signatures", () => {
    const first = createTaobaoSignature(
      "/traffic/theme/getThemeDimList",
      { page_size: "20", app_key: "demo", page_no: "1" },
      "secret"
    );
    const second = createTaobaoSignature(
      "/traffic/theme/getThemeDimList",
      { page_no: "1", page_size: "20", app_key: "demo" },
      "secret"
    );

    expect(first).toBe(second);
    expect(first).toMatch(/^[A-F0-9]{64}$/);
  });

  it("uses the daigou authorization-code flow and persists refreshable tokens", async () => {
    const directory = mkdtempSync(join(tmpdir(), "taobao-oauth-"));
    temporaryDirectories.push(directory);
    process.env.TAOBAO_GLOBAL_OPEN_APPKEY = "test-app";
    process.env.TAOBAO_GLOBAL_OPEN_APPSECRET = "test-secret";
    process.env.TAOBAO_AUTH_STATE_PATH = join(directory, "authorization.json");
    delete process.env.TAOBAO_GLOBAL_OPEN_TOKEN;
    delete process.env.TAOBAO_LEGACY_ENV_PATH;

    const authorizationUrl = new URL(
      await createTaobaoAuthorizationUrl("http://127.0.0.1:8787/api/integrations/taobao/callback")
    );
    expect(authorizationUrl.origin).toBe("https://api.taobao.global");
    expect(authorizationUrl.pathname).toBe("/oauth/authorize");
    expect(authorizationUrl.searchParams.get("client_id")).toBe("test-app");
    expect(authorizationUrl.searchParams.get("force_auth")).toBe("true");
    const state = authorizationUrl.searchParams.get("state");
    expect(state).toHaveLength(64);

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "new-access-token",
          refresh_token: "new-refresh-token",
          expires_in: 3600,
          refresh_expires_in: 86400
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    await completeTaobaoAuthorization("one-time-code", state ?? "");

    const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requestUrl.pathname).toBe("/rest/auth/token/create");
    expect(requestUrl.searchParams.has("access_token")).toBe(false);
    expect(await getTaobaoAuthorizationStatus()).toMatchObject({
      configured: true,
      authorized: true,
      source: "stored_oauth",
      refreshAvailable: true,
      requiresAuthorization: false
    });
  });

  it("rejects a callback whose OAuth state does not match", async () => {
    const directory = mkdtempSync(join(tmpdir(), "taobao-oauth-"));
    temporaryDirectories.push(directory);
    process.env.TAOBAO_GLOBAL_OPEN_APPKEY = "test-app";
    process.env.TAOBAO_GLOBAL_OPEN_APPSECRET = "test-secret";
    process.env.TAOBAO_AUTH_STATE_PATH = join(directory, "authorization.json");
    await createTaobaoAuthorizationUrl("http://127.0.0.1:8787/api/integrations/taobao/callback");

    await expect(completeTaobaoAuthorization("code", "wrong-state")).rejects.toThrow(/state is invalid/i);
  });

  it("marks a present but rejected token as requiring authorization", async () => {
    process.env.TAOBAO_GLOBAL_OPEN_APPKEY = "test-app";
    process.env.TAOBAO_GLOBAL_OPEN_APPSECRET = "test-secret";
    process.env.TAOBAO_GLOBAL_OPEN_TOKEN = "expired-token";
    delete process.env.TAOBAO_LEGACY_ENV_PATH;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "IllegalAccessToken", message: "access token is invalid or expired" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    await expect(taobaoThemeAdapter.discoverSignals()).rejects.toThrow(/IllegalAccessToken/);
    expect(await getTaobaoAuthorizationStatus()).toMatchObject({
      configured: true,
      authorized: false,
      requiresAuthorization: true,
      error: expect.stringMatching(/invalid or expired/)
    });
  });
});

function restoreEnvironment(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
