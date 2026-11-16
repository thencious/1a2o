import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { build } = require(
  require.resolve("esbuild", { paths: [dirname(require.resolve("tsx"))] }),
);
const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const result = await build({
  metafile: true,
  entryPoints: [resolve(app, "utils/notes-editor/browser.ts")],
  outfile: resolve(app, "public/open-todo-zero/vendor/obsidian-editor.js"),
  bundle: true,
  minify: true,
  format: "iife",
  platform: "browser",
  // CodeMirror extensions use instanceof; every language must share the
  // host's state/view instances even when pnpm retains transitive versions.
  alias: Object.fromEntries(
    [
      "@codemirror/state",
      "@codemirror/view",
      "@codemirror/language",
      "@codemirror/commands",
      "@codemirror/autocomplete",
      "@codemirror/search",
      "@lezer/common",
      "@lezer/highlight",
      "@lezer/markdown",
    ].map((name) => [name, resolve(app, "node_modules", name)]),
  ),
  target: "es2022",
  loader: { ".woff2": "file", ".woff": "file", ".ttf": "file" },
  assetNames: "obsidian-fonts/[name]-[hash]",
  legalComments: "eof",
});
const licenses = new Set([resolve(app, "vendor/obsidian-editor/LICENSE")]);
for (const input of Object.keys(result.metafile.inputs)) {
  if (!input.includes("node_modules")) continue;
  let directory = dirname(resolve(input));
  while (!existsSync(resolve(directory, "package.json"))) {
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  for (const name of readdirSync(directory))
    if (/^licen[sc]e(?:\.|$)/i.test(name))
      licenses.add(resolve(directory, name));
}
writeFileSync(
  resolve(app, "public/open-todo-zero/vendor/obsidian-editor.LICENSE.txt"),
  "Editor source: https://github.com/zacharyyamaoka/like_obsidian_md_viewer\n\n" +
    [...licenses].map((path) => readFileSync(path, "utf8")).join("\n\n---\n\n"),
);
