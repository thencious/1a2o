export function beeperDraftText(text: string, hasMentions = false): string {
  try {
    if (typeof JSON.parse(text) !== "string") return text;
  } catch {
    return text;
  }
  // Beeper interprets JSON string literals as serialized HTML. Encode literal
  // text explicitly; native mentions must keep their Markdown link formatting.
  if (hasMentions) return text.replace(/^(\s*)"/, '$1\\"');
  const html = text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/\r?\n/g, "<br>");
  return JSON.stringify(`<p>${html}</p>`);
}
