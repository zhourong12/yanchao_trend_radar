import { afterEach, describe, expect, it } from "vitest";
import { configuredGoogleTrendTargets, parseGoogleTimeline } from "./liveAdapters";

const originalGeos = process.env.GOOGLE_TRENDS_GEOS;
const originalWatchlist = process.env.TREND_WATCHLIST_KEYWORDS;

afterEach(() => {
  if (originalGeos === undefined) delete process.env.GOOGLE_TRENDS_GEOS;
  else process.env.GOOGLE_TRENDS_GEOS = originalGeos;
  if (originalWatchlist === undefined) delete process.env.TREND_WATCHLIST_KEYWORDS;
  else process.env.TREND_WATCHLIST_KEYWORDS = originalWatchlist;
});

describe("Google Trends adapter", () => {
  it("creates one query target per keyword and country", () => {
    process.env.GOOGLE_TRENDS_GEOS = "DE,US";
    process.env.TREND_WATCHLIST_KEYWORDS = "portable fan,pet cooling mat,car sun shade,waterproof shoe cover";
    const targets = configuredGoogleTrendTargets();

    expect(targets).toHaveLength(8);
    expect(targets.filter((target) => target.geo === "DE")).toHaveLength(4);
    expect(targets.filter((target) => target.geo === "US")).toHaveLength(4);
  });

  it("keeps the queried country as the signal market", () => {
    const signal = parseGoogleTimeline(
      JSON.stringify({
        default: {
          timelineData: [
            { time: "1", value: [20] },
            { time: "2", value: [40] },
            { time: "3", value: [80] }
          ]
        }
      }),
      "portable fan",
      "US"
    );

    expect(signal?.market).toBe("US");
    expect(signal?.id).toContain("us-portable-fan");
    expect(signal?.sourceUrl).toContain("geo=US");
  });
});
