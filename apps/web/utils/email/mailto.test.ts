import { describe, expect, it } from "vitest";
import { parseMailto } from "./mailto";

describe("parseMailto", () => {
  it("prefills recipients and encoded Unicode without losing plus addresses", () => {
    expect(
      parseMailto(
        "mailto:alice+work@example.com?to=bob%40example.com&CC=team%40example.com&bcc=private%40example.com&subject=Caf%C3%A9%20%26%20lunch&body=1+2%0D%0A%3Cb%3Ehello%3C%2Fb%3E",
      ),
    ).toEqual({
      to: "alice+work@example.com, bob@example.com",
      cc: "team@example.com",
      bcc: "private@example.com",
      subject: "Café & lunch",
      draftHtml: "<p>1+2<br />&lt;b&gt;hello&lt;/b&gt;</p>",
    });
  });

  it("ignores transport headers and strips header line breaks", () => {
    const result = parseMailto(
      "mailto:alice@example.com?subject=Hi%0D%0ABcc:bad&from=other@example.com&attachment=file:///private&cc=a@example.com&cc=b@example.com",
    );
    expect(result).toEqual({
      to: "alice@example.com",
      cc: "a@example.com, b@example.com",
      bcc: "",
      subject: "Hi  Bcc:bad",
      draftHtml: "",
    });
  });

  it("supports empty compose links and rejects unrelated or malformed links", () => {
    expect(parseMailto("mailto:")?.to).toBe("");
    expect(parseMailto("https://example.com")).toBeNull();
    expect(parseMailto("mailto:bad%escape")).toBeNull();
  });
});
