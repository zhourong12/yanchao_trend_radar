import { describe, expect, it } from "vitest";
import { parseGoogleTrendingRss } from "./googleTrendingAdapter";

describe("Google Trending Now RSS adapter", () => {
  it("discovers product candidates without a seed keyword", () => {
    const signals = parseGoogleTrendingRss(
      `<?xml version="1.0" encoding="UTF-8"?>
      <rss xmlns:ht="https://trends.google.com/trending/rss" version="2.0">
        <channel>
          <item>
            <title>portable fan heatwave</title>
            <ht:approx_traffic>20K+</ht:approx_traffic>
            <pubDate>Sun, 12 Jul 2026 21:00:00 -0700</pubDate>
          </item>
          <item>
            <title>football results</title>
            <ht:approx_traffic>100K+</ht:approx_traffic>
          </item>
        </channel>
      </rss>`,
      "AU"
    );

    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      keyword: "portable fan",
      market: "AU",
      sourceKind: "official",
      sourcePlatform: "google-trending",
      sourceTopic: "portable fan heatwave"
    });
    expect(signals[0].growthRate).toBe(0);
  });
});
