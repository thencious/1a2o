import { textToHtmlParagraphs } from "@/utils/string";

export function parseMailto(uri: string) {
  if (!/^mailto:/i.test(uri)) return null;
  const [address, ...query] = uri.slice(7).split("?");
  try {
    // Mailto uses URI encoding: a literal + is part of an address or body.
    const params = new URLSearchParams(query.join("?").replace(/\+/g, "%2B"));
    const fields = new Map<string, string[]>();
    for (const [key, value] of params) {
      const name = key.toLowerCase();
      fields.set(name, [...(fields.get(name) ?? []), value]);
    }
    const header = (name: string) =>
      (fields.get(name) ?? []).join(", ").replace(/[\r\n\0]/g, " ");
    return {
      to: [decodeURIComponent(address), header("to")]
        .filter(Boolean)
        .join(", ")
        .replace(/[\r\n\0]/g, " "),
      cc: header("cc"),
      bcc: header("bcc"),
      subject: header("subject"),
      draftHtml: textToHtmlParagraphs((fields.get("body") ?? []).join("\n")),
    };
  } catch {
    return null;
  }
}
