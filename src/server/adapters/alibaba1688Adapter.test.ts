import { describe, expect, it } from "vitest";
import { createAlibaba1688Signature } from "./alibaba1688Adapter";

describe("1688 Global Open signing", () => {
  it("uses deterministic uppercase HMAC-SHA1 signatures", () => {
    const apiInfo = "param2/1/com.alibaba.fenxiao.crossborder/product.search.keywordQuery/demo";
    const first = createAlibaba1688Signature(
      apiInfo,
      { language: "en", access_token: "token", offerQueryParam: '{"keyword":"fan"}' },
      "secret"
    );
    const second = createAlibaba1688Signature(
      apiInfo,
      { offerQueryParam: '{"keyword":"fan"}', access_token: "token", language: "en" },
      "secret"
    );

    expect(first).toBe(second);
    expect(first).toMatch(/^[A-F0-9]{40}$/);
  });
});
