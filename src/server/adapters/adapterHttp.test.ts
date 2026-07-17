import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAdapterJson, fetchAdapterText } from "./adapterHttp";

afterEach(() => vi.unstubAllGlobals());

describe("adapter HTTP", () => {
  it("applies shared response validation and JSON parsing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchAdapterJson("https://example.test/data", {
        label: "Example",
        timeoutMs: 1_000,
        maximumBytes: 100,
        init: { headers: { "X-Test": "yes" } }
      })
    ).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/data",
      expect.objectContaining({ headers: { "X-Test": "yes" }, signal: expect.any(AbortSignal) })
    );
  });

  it("rejects oversized responses consistently", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("too-large", { status: 200 })));

    await expect(
      fetchAdapterText("https://example.test/data", {
        label: "Example",
        timeoutMs: 1_000,
        maximumBytes: 3
      })
    ).rejects.toThrow("response exceeded 3 bytes");
  });
});
