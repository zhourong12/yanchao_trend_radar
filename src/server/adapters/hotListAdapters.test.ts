import { describe, expect, it } from "vitest";
import { mapHotTopicToProduct, normalizeHotItemToSignal } from "./hotListAdapters";

describe("hot list adapters", () => {
  it("maps heat topics with product intent to portable cooling opportunities", () => {
    const mapped = mapHotTopicToProduct("\u9ad8\u6e29\u901a\u52e4\u968f\u8eab\u964d\u6e29\u98ce\u6247");
    expect(mapped).toMatchObject({ keyword: "portable fan", category: "small-appliance" });
  });

  it("maps rainstorm topics with commuting intent to waterproof products", () => {
    const mapped = mapHotTopicToProduct("\u53f0\u98ce\u5929\u901a\u52e4\u978b\u5b50\u9632\u6c34\u9632\u6ed1");
    expect(mapped).toMatchObject({ keyword: "waterproof shoe cover", category: "outdoor" });
  });

  it("does not map generic news or drink topics without product intent", () => {
    expect(mapHotTopicToProduct("\u8d85\u5f3a\u53f0\u98ce\u5df4\u5a01\u5b9e\u65f6\u8def\u5f84")).toBeNull();
    expect(mapHotTopicToProduct("\u8fd9\u53e3\u51b0\u7ea2\u8336\u624d\u662f\u590f\u5929\u7684\u795e")).toBeNull();
  });

  it("classifies pet and car heat topics before generic cooling", () => {
    expect(mapHotTopicToProduct("宠物高温降温垫怎么选")).toMatchObject({ keyword: "pet cooling mat" });
    expect(mapHotTopicToProduct("汽车高温车窗遮阳防晒")).toMatchObject({ keyword: "car sun shade" });
  });

  it("turns multilingual heat events into low-confidence opportunity hypotheses", () => {
    expect(mapHotTopicToProduct("canicule prévisions france")).toMatchObject({
      keyword: "portable fan",
      confidence: 0.5
    });
    expect(mapHotTopicToProduct("Hitzewelle Warnung Deutschland")).toMatchObject({
      keyword: "portable fan",
      confidence: 0.5
    });
  });

  it("normalizes 60s style hot items into trend signals", () => {
    const signal = normalizeHotItemToSignal(
      {
        title: "\u9ad8\u6e29\u901a\u52e4\u968f\u8eab\u964d\u6e29\u98ce\u6247",
        hot_value: 7_848_497,
        link: "https://www.douyin.com/search/test"
      },
      "douyin",
      { source: "60s open-source hot API", methodology: "test", riskLevel: "high", baseUrl: "https://60s.viki.moe/v2" }
    );

    expect(signal).toMatchObject({
      origin: "live",
      sourceKind: "third_party",
      sourceUrl: "https://www.douyin.com/search/test",
      sourceRisk: "high",
      sourcePlatform: "douyin",
      keyword: "portable fan",
      market: "CN"
    });
    expect(signal?.currentIndex).toBeGreaterThan(60);
  });
});
