import { describe, expect, it } from "vitest";
import { presentBusinessError } from "./api";

describe("business error presentation", () => {
  it("hides technical transport and API details", () => {
    expect(presentBusinessError("Amazon API HTTP 503 response schema invalid", "销售验证暂不可用")).toBe(
      "销售验证暂不可用"
    );
    expect(presentBusinessError("request timed out", "操作失败")).toBe("平台响应超时，请稍后重试");
    expect(presentBusinessError("OAuth token expired", "操作失败")).toBe("账号授权已失效或权限不足，请重新授权");
  });
});
