import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearConfiguredSalesCache,
  fetchConfiguredSales,
  fetchConfiguredSupply,
  getConfiguredSalesState
} from "./liveBusinessAdapters";

afterEach(() => {
  delete process.env.SUPPLY_SOURCE_API_URL;
  delete process.env.SALES_SOURCE_API_URL;
  delete process.env.SUPPLY_SOURCE_API_TOKEN;
  delete process.env.SALES_SOURCE_API_TOKEN;
  delete process.env.SALES_SOURCE_PROVIDER;
  delete process.env.SALES_SOURCE_CACHE_TTL_SECONDS;
  clearConfiguredSalesCache();
  vi.unstubAllGlobals();
});

describe("configured business adapters", () => {
  it("returns null when no authorized endpoint is configured", async () => {
    await expect(fetchConfiguredSupply("portable fan", "EU")).resolves.toBeNull();
    await expect(fetchConfiguredSales("portable fan", "EU")).resolves.toBeNull();
  });

  it("normalizes supply and sales contracts as live third-party evidence", async () => {
    process.env.SUPPLY_SOURCE_API_URL = "https://supply.example.test/search";
    process.env.SALES_SOURCE_API_URL = "https://sales.example.test/search";
    process.env.SALES_SOURCE_API_TOKEN = "sales-token";
    const fetchMock = vi.fn().mockImplementation((url: URL) => {
      if (url.hostname.startsWith("supply")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              productName: "Portable fan",
              supplierCount: 12,
              minPriceCny: 10,
              maxPriceCny: 24,
              moq: 5,
              leadTimeDays: 4,
              complianceTags: ["CE"]
            }),
            { status: 200 }
          )
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            platform: "Amazon",
            competitorCount: 120,
            targetPriceUsd: 18,
            reviewPainPoints: ["noise"],
            demandProxy: 72
          }),
          { status: 200 }
        )
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchConfiguredSupply("portable fan", "EU")).resolves.toMatchObject({
      origin: "live",
      sourceKind: "third_party"
    });
    await expect(fetchConfiguredSales("portable fan", "EU")).resolves.toMatchObject({
      origin: "live",
      sourceKind: "third_party"
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.any(URL),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer sales-token" }) })
    );
  });

  it("uses the configured provider provenance and caches successful sales lookups", async () => {
    process.env.SALES_SOURCE_API_URL = "https://sales.example.test/search";
    process.env.SALES_SOURCE_PROVIDER = "amazon-sp-api";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          platform: "Amazon US",
          competitorCount: 34,
          targetPriceUsd: 25,
          reviewPainPoints: ["packaging"],
          demandProxy: 81,
          observedAt: "2026-07-17T01:00:00.000Z"
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = await fetchConfiguredSales("Portable Fan", "us");
    const second = await fetchConfiguredSales("portable fan", "US");

    expect(first).toMatchObject({
      origin: "live",
      sourceKind: "official",
      sourceRisk: "low",
      observedAt: "2026-07-17T01:00:00.000Z"
    });
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getConfiguredSalesState()).toMatchObject({ provider: "amazon-sp-api", ok: true, cacheHit: true });
  });

  it("can disable sales caching for collection-time refreshes", async () => {
    process.env.SALES_SOURCE_API_URL = "https://sales.example.test/search";
    process.env.SALES_SOURCE_CACHE_TTL_SECONDS = "0";
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            platform: "Amazon",
            competitorCount: 20,
            targetPriceUsd: 19,
            reviewPainPoints: [],
            demandProxy: 60
          }),
          { status: 200 }
        )
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchConfiguredSales("portable fan", "US");
    await fetchConfiguredSales("portable fan", "US");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
