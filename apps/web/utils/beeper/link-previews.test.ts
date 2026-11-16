import { beforeEach, describe, expect, it, vi } from "vitest";
import { completeLinkPreview, fetchPreviewImage } from "./link-previews";
import { safePublicFetch } from "@/utils/mcp/safe-fetch";

vi.mock("server-only", () => ({}));
vi.mock("@/utils/mcp/safe-fetch", () => ({ safePublicFetch: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

describe("standard link previews", () => {
  it("uses Beeper's existing preview without fetching the page again", async () => {
    const native = {
      url: "https://example.org/native",
      title: "Native",
      image: "https://cdn.example.org/image.jpg",
    };
    expect(await completeLinkPreview(native)).toBe(native);
    expect(safePublicFetch).not.toHaveBeenCalled();
  });
  it("extracts real Open Graph metadata and coalesces cached requests", async () => {
    vi.mocked(safePublicFetch).mockResolvedValue(
      new Response(
        '<html><head><title>Fallback</title><meta property="og:title" content="Open Graph title"><meta property="og:description" content="A &amp; B"><meta property="og:image" content="https://cdn.example.org/card.jpg"></head></html>',
        { headers: { "Content-Type": "text/html" } },
      ),
    );
    const input = { url: "https://example.org/open-graph", title: "" };
    const [first, second] = await Promise.all([
      completeLinkPreview(input),
      completeLinkPreview(input),
    ]);
    expect(first).toMatchObject({
      title: "Open Graph title",
      description: "A & B",
      image: "https://cdn.example.org/card.jpg",
    });
    expect(second).toEqual(first);
    expect(await completeLinkPreview(input)).toEqual(first);
    expect(safePublicFetch).toHaveBeenCalledTimes(1);
  });
  it("follows guarded redirects and preserves the original clickable URL", async () => {
    vi.mocked(safePublicFetch)
      .mockResolvedValueOnce(
        new Response(null, { status: 301, headers: { location: "/article" } }),
      )
      .mockResolvedValueOnce(
        new Response(
          '<html><head><title>Article title</title><meta name="description" content="Description"></head></html>',
          { headers: { "Content-Type": "text/html" } },
        ),
      );
    const result = await completeLinkPreview({
      url: "http://example.org/redirect-test",
      title: "",
    });
    expect(result).toMatchObject({
      url: "http://example.org/redirect-test",
      title: "Article title",
      description: "Description",
    });
    expect(safePublicFetch).toHaveBeenNthCalledWith(
      2,
      "https://example.org/article",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
  it("keeps the link usable when metadata is unavailable or too large", async () => {
    vi.mocked(safePublicFetch).mockRejectedValueOnce(
      new Error("Blocked private target"),
    );
    expect(
      await completeLinkPreview({
        url: "https://example.org/blocked",
        title: "",
      }),
    ).toEqual({
      url: "https://example.org/blocked",
      title: "",
      description: undefined,
      image: undefined,
    });
    vi.mocked(safePublicFetch).mockResolvedValueOnce(
      new Response("x".repeat(1_000_001), {
        headers: { "Content-Type": "text/html" },
      }),
    );
    expect(
      (
        await completeLinkPreview({
          url: "https://example.org/large",
          title: "",
        })
      ).title,
    ).toBe("");
  });
  it("returns private raster images and refuses executable image content", async () => {
    vi.mocked(safePublicFetch).mockResolvedValueOnce(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "Content-Type": "image/png" },
      }),
    );
    const image = await fetchPreviewImage("https://cdn.example.org/image.png");
    expect(image.headers.get("Cache-Control")).toBe("private, max-age=3600");
    expect(image.headers.get("X-Content-Type-Options")).toBe("nosniff");
    vi.mocked(safePublicFetch).mockResolvedValueOnce(
      new Response("<svg></svg>", {
        headers: { "Content-Type": "image/svg+xml" },
      }),
    );
    await expect(
      fetchPreviewImage("https://cdn.example.org/unsafe.svg"),
    ).rejects.toThrow("Unsupported preview image");
  });
});
