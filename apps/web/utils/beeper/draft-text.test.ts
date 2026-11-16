import { expect, it } from "vitest";
import { convert } from "html-to-text";
import { beeperDraftText } from "./draft-text";
it.each([
  '"clean"',
  '"hello \\n world"',
  '"<b>literal</b> & not HTML"',
  '"\\"nested\\""',
  '"[label](https://example.org)"',
])("preserves a literal quoted message through Beeper's JSON/HTML input path: %s", (text) => {
  expect(convert(JSON.parse(beeperDraftText(text)), { wordwrap: false })).toBe(
    text,
  );
});
it.each([
  "clean",
  "“clean”",
  'say "clean" please',
  '"unfinished',
  "https://example.org",
  "ordinary\nmessage",
  '{"key":"value"}',
  "[1,2]",
])("keeps ordinary composer input unchanged: %s", (text) => {
  expect(beeperDraftText(text)).toBe(text);
});
it("keeps native mention Markdown on the Markdown parser path without losing the outer quote", () => {
  const text = '"[@Alex](https://matrix.to/#/@alex:example.org)"';
  const transport = beeperDraftText(text, true);
  expect(() => JSON.parse(transport)).toThrow();
  expect(transport).toBe(`\\${text}`);
});
