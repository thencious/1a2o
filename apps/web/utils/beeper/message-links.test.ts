import { describe, expect, it } from "vitest";
import { messagePreviewLinks, webLinkUrl } from "./message-links";

describe("message link detection", () => {
  it("uses standard URL detection with punctuation and bare domains", () => {
    expect(
      messagePreviewLinks(
        "See https://example.com/path?q=1, and www.example.org. Email alex@example.net.",
      ).map((link) => link.url),
    ).toEqual(["https://example.com/path?q=1", "http://www.example.org/"]);
  });
  it("uses native previews instead of duplicating them for tracking links", () => {
    const native = {
      url: "https://example.com",
      title: "Native title",
      description: "Native summary",
    };
    expect(
      messagePreviewLinks(
        "https://example.com https://a.example.org https://b.example.org https://c.example.org",
        [native],
      ),
    ).toEqual([{ ...native, url: "https://example.com/" }]);
  });
  it("deduplicates detected URLs and limits fallback cards", () => {
    expect(
      messagePreviewLinks(
        "https://example.com https://example.com https://a.example.org https://b.example.org https://c.example.org",
      ).map((link) => link.url),
    ).toEqual([
      "https://example.com/",
      "https://a.example.org/",
      "https://b.example.org/",
    ]);
  });
  it("excludes unsafe schemes, credentials, and non-website links from cards", () => {
    expect(webLinkUrl("javascript:alert(1)")).toBeNull();
    expect(webLinkUrl("https://user:secret@example.org")).toBeNull();
    expect(messagePreviewLinks("alex@example.com report.final")).toEqual([]);
  });
});
