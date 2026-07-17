import { existsSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import cors from "cors";
import express from "express";
import { z } from "zod";
import {
  getSourceHealth,
  getAnalysisDigest,
  getTodayCollectionDashboard,
  createManualOpportunity,
  listOpportunities,
  listSignals,
  listTrendCandidates,
  opportunityExists,
  recordFeedback,
  runCollectionNow,
  searchSupply,
  testCollectionSource
} from "./domain/opportunityService";
import { checkStateStore } from "./domain/stateStore";
import {
  completeTaobaoAuthorization,
  createTaobaoAuthorizationUrl,
  getTaobaoAuthorizationStatus
} from "./adapters/taobaoGlobalAdapter";
import {
  completeAlibaba1688Authorization,
  createAlibaba1688AuthorizationUrl,
  getAlibaba1688AuthorizationStatus
} from "./adapters/alibaba1688Adapter";

const feedbackSchema = z.object({
  opportunityId: z.string().min(1),
  action: z.enum(["useful", "not_useful", "follow_up", "verifying", "sampling", "listed", "rejected"]),
  note: z.string().max(500).optional(),
  owner: z.string().max(80).optional(),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  evidenceUrl: z.string().url().optional(),
  outcome: z
    .object({
      observedAt: z.string().datetime(),
      unitsSold: z.number().int().nonnegative().optional(),
      revenueUsd: z.number().nonnegative().optional(),
      grossProfitUsd: z.number().optional(),
      returnRate: z.number().min(0).max(1).optional()
    })
    .optional()
});
const statusQuerySchema = z.enum([
  "all",
  "new",
  "watching",
  "follow_up",
  "verifying",
  "sampling",
  "listed",
  "rejected"
]);
const marketQuerySchema = z.union([z.literal("all"), z.string().regex(/^[A-Z]{2,3}$/)]);
const sourceIdSchema = z.string().regex(/^[a-z0-9-]{2,80}$/);
const supplySearchSchema = z.object({
  keyword: z.string().trim().min(2).max(100),
  market: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,3}$/)
    .default("CN")
});
const manualOpportunitySchema = z.object({
  productName: z.string().trim().min(2).max(120),
  market: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,3}$/),
  category: z.string().trim().min(2).max(80),
  eventName: z.string().trim().min(2).max(120),
  demand: z.string().trim().min(2).max(200),
  reason: z.string().trim().min(4).max(500),
  timeWindow: z.string().trim().max(80).optional(),
  nextAction: z.string().trim().max(300).optional()
});

interface AppOptions {
  serveClient?: boolean;
  clientMiddleware?: express.RequestHandler;
}

export function createApp(options: AppOptions = {}) {
  const app = express();
  const allowedOrigins = configuredOrigins();
  const rateLimit = createRateLimiter(30, 60_000);
  const collectionRateLimit = createRateLimiter(6, 60_000);

  app.disable("x-powered-by");
  app.use((_request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
  });
  app.use(cors({ origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)) }));
  app.use(express.json({ limit: "32kb" }));

  app.get("/api/health", async (_request, response, next) => {
    try {
      const sources = await getSourceHealth();
      const failedSources = sources.filter((source) => !source.ok);
      response.json({
        ok: true,
        service: "yanchao-opportunity-radar",
        degraded: failedSources.length > 0,
        sources
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/ready", async (_request, response) => {
    try {
      await checkStateStore();
      const opportunities = await listOpportunities();
      response
        .status(opportunities.length > 0 ? 200 : 503)
        .json({ ready: opportunities.length > 0, opportunityCount: opportunities.length });
    } catch (error) {
      response
        .status(503)
        .json({ ready: false, error: error instanceof Error ? error.message : "Readiness check failed" });
    }
  });

  app.get("/api/metrics", async (_request, response, next) => {
    try {
      const sources = await getSourceHealth();
      const memory = process.memoryUsage();
      response.json({
        uptimeSeconds: Math.round(process.uptime()),
        memoryBytes: {
          rss: memory.rss,
          heapUsed: memory.heapUsed,
          heapTotal: memory.heapTotal
        },
        sourceSuccessCount: sources.filter((source) => source.ok).length,
        sourceFailureCount: sources.filter((source) => !source.ok).length,
        sources
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/signals", async (_request, response, next) => {
    try {
      response.json({ data: await listSignals() });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/trend-candidates", async (_request, response, next) => {
    try {
      response.json({ data: await listTrendCandidates() });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/collections/today", async (_request, response, next) => {
    try {
      response.json({ data: await getTodayCollectionDashboard() });
    } catch (error) {
      next(error);
    }
  });

  app.post(
    "/api/collections/run",
    enforceWriteOrigin(allowedOrigins),
    authorizeAdmin,
    collectionRateLimit,
    async (_request, response, next) => {
      try {
        response.json({ data: await runCollectionNow() });
      } catch (error) {
        next(error);
      }
    }
  );

  app.post(
    "/api/sources/:sourceId/test",
    enforceWriteOrigin(allowedOrigins),
    authorizeAdmin,
    collectionRateLimit,
    async (request, response, next) => {
      const sourceId = sourceIdSchema.safeParse(request.params.sourceId);
      if (!sourceId.success) {
        response.status(400).json({ error: "Invalid source id" });
        return;
      }
      try {
        const source = await testCollectionSource(sourceId.data);
        if (!source) {
          response.status(404).json({ error: "Source not found" });
          return;
        }
        response.status(source.ok ? 200 : 502).json({ data: source });
      } catch (error) {
        next(error);
      }
    }
  );

  app.post(
    "/api/supply/search",
    enforceWriteOrigin(allowedOrigins),
    authorizeAdmin,
    async (request, response, next) => {
      const query = supplySearchSchema.safeParse({
        keyword: request.body.keyword,
        market: request.body.market ?? "CN"
      });
      if (!query.success) {
        response.status(400).json({ error: "Invalid supply search", issues: query.error.issues });
        return;
      }
      try {
        response.json({ data: await searchSupply(query.data.keyword, query.data.market) });
      } catch (error) {
        next(error);
      }
    }
  );

  app.get("/api/analysis", async (_request, response, next) => {
    try {
      response.json({ data: await getAnalysisDigest() });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/integrations/taobao/status", async (_request, response, next) => {
    try {
      response.json({ data: await getTaobaoAuthorizationStatus() });
    } catch (error) {
      next(error);
    }
  });

  app.post(
    "/api/integrations/taobao/authorize-url",
    enforceWriteOrigin(allowedOrigins),
    authorizeAdmin,
    async (request, response, next) => {
      try {
        if (process.env.NODE_ENV === "production" && process.env.TAOBAO_OAUTH_ENABLED !== "true") {
          response.status(403).json({ error: "Taobao OAuth is disabled" });
          return;
        }
        const redirectUri =
          process.env.TAOBAO_GLOBAL_OPEN_REDIRECT_URI ??
          `${request.protocol}://${request.get("host")}/api/integrations/taobao/callback`;
        response.json({ data: { url: await createTaobaoAuthorizationUrl(redirectUri) } });
      } catch (error) {
        next(error);
      }
    }
  );

  app.get("/api/integrations/taobao/callback", async (request, response) => {
    const code = typeof request.query.code === "string" ? request.query.code : "";
    const state = typeof request.query.state === "string" ? request.query.state : "";
    if (!code || !state) {
      response.status(400).type("html").send(taobaoAuthorizationPage(false, "授权回调缺少 code 或 state。"));
      return;
    }
    try {
      await completeTaobaoAuthorization(code, state);
      response.type("html").send(taobaoAuthorizationPage(true, "淘宝账号授权完成，系统已保存并启用 Token。"));
    } catch (error) {
      response
        .status(400)
        .type("html")
        .send(taobaoAuthorizationPage(false, error instanceof Error ? error.message : "淘宝授权失败。"));
    }
  });

  app.get("/api/integrations/1688/status", async (_request, response, next) => {
    try {
      response.json({ data: await getAlibaba1688AuthorizationStatus() });
    } catch (error) {
      next(error);
    }
  });

  app.post(
    "/api/integrations/1688/authorize-url",
    enforceWriteOrigin(allowedOrigins),
    authorizeAdmin,
    async (request, response, next) => {
      try {
        if (process.env.NODE_ENV === "production" && process.env.ALIBABA_1688_OAUTH_ENABLED !== "true") {
          response.status(403).json({ error: "1688 OAuth is disabled" });
          return;
        }
        const redirectUri =
          process.env.ALIBABA_1688_REDIRECT_URI ??
          `${request.protocol}://${request.get("host")}/api/integrations/1688/callback`;
        response.json({ data: { url: await createAlibaba1688AuthorizationUrl(redirectUri) } });
      } catch (error) {
        next(error);
      }
    }
  );

  app.get("/api/integrations/1688/callback", async (request, response) => {
    const code = typeof request.query.code === "string" ? request.query.code : "";
    const state = typeof request.query.state === "string" ? request.query.state : "";
    if (!code || !state) {
      response
        .status(400)
        .type("html")
        .send(integrationAuthorizationPage("1688", false, "授权回调缺少 code 或 state。"));
      return;
    }
    try {
      await completeAlibaba1688Authorization(code, state);
      response
        .type("html")
        .send(integrationAuthorizationPage("1688", true, "1688 账号授权完成，系统已加密保存并启用 Token。"));
    } catch (error) {
      response
        .status(400)
        .type("html")
        .send(integrationAuthorizationPage("1688", false, error instanceof Error ? error.message : "1688 授权失败。"));
    }
  });

  app.get("/api/opportunities", async (request, response, next) => {
    try {
      const market = marketQuerySchema.safeParse(String(request.query.market ?? "all"));
      const status = statusQuerySchema.safeParse(String(request.query.status ?? "all"));
      if (!market.success || !status.success) {
        response.status(400).json({ error: "Invalid opportunity query" });
        return;
      }
      const data = (await listOpportunities()).filter((opportunity) => {
        const marketMatch = market.data === "all" || opportunity.market === market.data;
        const statusMatch = status.data === "all" || opportunity.status === status.data;
        return marketMatch && statusMatch;
      });
      response.json({ data });
    } catch (error) {
      next(error);
    }
  });

  app.post(
    "/api/opportunities/manual",
    enforceWriteOrigin(allowedOrigins),
    authorizeFeedback,
    rateLimit,
    async (request, response, next) => {
      const parsed = manualOpportunitySchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({ error: "Invalid manual opportunity", issues: parsed.error.issues });
        return;
      }
      try {
        const opportunity = await createManualOpportunity(parsed.data);
        console.info(
          JSON.stringify({
            event: "manual_opportunity_created",
            opportunityId: opportunity.id,
            market: opportunity.market,
            at: new Date().toISOString()
          })
        );
        response.status(201).json({ data: opportunity });
      } catch (error) {
        next(error);
      }
    }
  );

  app.post(
    "/api/feedback",
    enforceWriteOrigin(allowedOrigins),
    authorizeFeedback,
    rateLimit,
    async (request, response, next) => {
      const parsed = feedbackSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({ error: "Invalid feedback payload", issues: parsed.error.issues });
        return;
      }
      try {
        if (!(await opportunityExists(parsed.data.opportunityId))) {
          response.status(404).json({ error: "Opportunity not found" });
          return;
        }
        const result = await recordFeedback(parsed.data);
        console.info(
          JSON.stringify({
            event: "opportunity_feedback_recorded",
            opportunityId: parsed.data.opportunityId,
            action: parsed.data.action,
            owner: parsed.data.owner,
            at: new Date().toISOString()
          })
        );
        response.json({ data: result });
      } catch (error) {
        next(error);
      }
    }
  );

  if (options.clientMiddleware) app.use(options.clientMiddleware);

  const clientDirectory = resolve(process.cwd(), "dist");
  if (options.serveClient !== false && existsSync(clientDirectory)) {
    app.use(
      express.static(clientDirectory, { index: false, maxAge: process.env.NODE_ENV === "production" ? "1h" : 0 })
    );
    app.get("*", (request, response, next) => {
      if (request.path.startsWith("/api/")) return next();
      response.sendFile(resolve(clientDirectory, "index.html"));
    });
  }

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    void _next;
    console.error(
      JSON.stringify({ event: "request_failed", error: error instanceof Error ? error.message : String(error) })
    );
    response.status(500).json({ error: "Internal server error" });
  });

  return app;
}

function taobaoAuthorizationPage(success: boolean, message: string) {
  return integrationAuthorizationPage("淘宝", success, message);
}

function integrationAuthorizationPage(provider: string, success: boolean, message: string) {
  const title = success ? `${provider}授权成功` : `${provider}授权失败`;
  const safeMessage = message.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return entities[character];
  });
  const appUrl = process.env.APP_PUBLIC_URL ?? "http://127.0.0.1:8787/";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;background:#f5f7fb;color:#172033;font:16px/1.6 system-ui,sans-serif;display:grid;min-height:100vh;place-items:center}.card{width:min(520px,calc(100% - 40px));background:#fff;border:1px solid #e4e9f2;border-radius:18px;padding:36px;box-shadow:0 20px 60px rgba(34,54,92,.12)}h1{margin:0 0 12px;font-size:28px}.status{color:${success ? "#15803d" : "#b42318"}}a{display:inline-block;margin-top:18px;padding:10px 18px;border-radius:10px;background:#1d4ed8;color:#fff;text-decoration:none}</style></head><body><main class="card"><p class="status">${success ? "授权已完成" : "需要处理"}</p><h1>${title}</h1><p>${safeMessage}</p><a href="${appUrl}">返回机会雷达</a></main></body></html>`;
}

function configuredOrigins() {
  const defaults = process.env.NODE_ENV === "production" ? [] : ["http://127.0.0.1:8787", "http://localhost:8787"];
  const configured =
    process.env.CORS_ORIGINS?.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean) ?? [];
  return new Set([...defaults, ...configured]);
}

function enforceWriteOrigin(allowedOrigins: Set<string>): express.RequestHandler {
  return (request, response, next) => {
    const origin = request.get("origin");
    if (!origin || allowedOrigins.has(origin) || isSameOrigin(origin, request)) return next();
    response.status(403).json({ error: "Origin not allowed" });
  };
}

function isSameOrigin(origin: string, request: express.Request) {
  try {
    const parsed = new URL(origin);
    return parsed.host === request.get("host");
  } catch {
    return false;
  }
}

function authorizeFeedback(request: express.Request, response: express.Response, next: express.NextFunction) {
  const expectedToken = process.env.FEEDBACK_API_TOKEN ?? process.env.ADMIN_API_TOKEN;
  const tokenRequired = process.env.REQUIRE_FEEDBACK_TOKEN === "true" || process.env.NODE_ENV === "production";
  if (!expectedToken && !tokenRequired) return next();
  if (!expectedToken) {
    response.status(503).json({ error: "Feedback authentication is not configured" });
    return;
  }
  const bearer = request.get("authorization")?.replace(/^Bearer\s+/i, "");
  const supplied = bearer ?? request.get("x-api-key");
  if (!safeTokenEquals(supplied, expectedToken)) {
    response.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

function authorizeAdmin(request: express.Request, response: express.Response, next: express.NextFunction) {
  const expectedToken = process.env.ADMIN_API_TOKEN ?? process.env.FEEDBACK_API_TOKEN;
  const tokenRequired = process.env.REQUIRE_ADMIN_TOKEN === "true" || process.env.NODE_ENV === "production";
  if (!expectedToken && !tokenRequired) return next();
  if (!expectedToken) {
    response.status(503).json({ error: "Administrative authentication is not configured" });
    return;
  }
  const bearer = request.get("authorization")?.replace(/^Bearer\s+/i, "");
  const supplied = bearer ?? request.get("x-api-key");
  if (!safeTokenEquals(supplied, expectedToken)) {
    response.status(401).json({ error: "Administrative authorization required" });
    return;
  }
  next();
}

function safeTokenEquals(supplied: string | undefined, expected: string) {
  if (!supplied) return false;
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer);
}

function createRateLimiter(limit: number, windowMs: number): express.RequestHandler {
  const counters = new Map<string, { count: number; resetAt: number }>();
  return (request, response, next) => {
    const key = request.ip ?? request.socket.remoteAddress ?? "unknown";
    const now = Date.now();
    const current = counters.get(key);
    const nextCounter =
      !current || current.resetAt <= now
        ? { count: 1, resetAt: now + windowMs }
        : { ...current, count: current.count + 1 };
    counters.set(key, nextCounter);
    response.setHeader("RateLimit-Limit", limit);
    response.setHeader("RateLimit-Remaining", Math.max(0, limit - nextCounter.count));
    if (nextCounter.count > limit) {
      response.status(429).json({ error: "Too many feedback requests" });
      return;
    }
    next();
  };
}
