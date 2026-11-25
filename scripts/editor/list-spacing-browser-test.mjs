import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "../../apps/web/node_modules/@playwright/test/index.mjs";

const root = resolve(import.meta.dirname, "../../apps/web/public/open-todo-zero");
const output = resolve(import.meta.dirname, "../../.context/qa/list-spacing");
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 650 } });
  const css = ["vendor/toastui-editor.css", "vendor/toastui-editor-dark.css", "styles.css", "vendor/obsidian-editor.css"].map(file => readFileSync(resolve(root, file), "utf8")).join("\n");
  await page.setContent(`<style>${css}body{background:#202020;color:#ddd}#editor{width:850px;height:580px}</style><div id="editor"></div>`);
  await page.addScriptTag({ path: resolve(root, "vendor/toastui-editor.js") });
  await page.addScriptTag({ path: resolve(root, "vendor/obsidian-editor.js") });
  await page.evaluate(() => { window.editor = new window.WorkspaceMarkdownEditor({ el: document.getElementById("editor") }); });
  const seeds = ["- first", "* first", "+ first", "1. first", "9. first", "1) first", "- [ ] first", "- [x] first", "1. [ ] first", "- parent\n  - first", "1. parent\n   1. first", "- parent\n  - [ ] first"];
  for (const seed of seeds) {
    await page.evaluate(seed => {
      window.editor.setMarkdown(seed);
      window.editor.view.dispatch({ selection: { anchor: window.editor.view.state.doc.length } });
      window.editor.focus();
    }, seed);
    await page.keyboard.press("Enter");
    const before = await page.evaluate(() => ({ doc: window.editor.getMarkdown(), x: window.editor.view.coordsAtPos(window.editor.view.state.doc.length).left }));
    await page.keyboard.insertText("x");
    const populated = await page.evaluate(() => ({ doc: window.editor.getMarkdown(), x: window.editor.view.coordsAtPos(window.editor.view.state.doc.length - 1).left }));
    assert.equal(populated.doc, `${before.doc}x`, "Spacing fixes must preserve the actual Markdown source");
    assert(Math.abs(populated.x - before.x) < 1, `Empty and populated list carets differ for ${seed}`);
    await page.keyboard.press("Backspace");
    const afterDelete = await page.evaluate(() => window.editor.view.coordsAtPos(window.editor.view.state.doc.length).left);
    assert(Math.abs(afterDelete - before.x) < 1, `Deleting content moves the caret for ${seed}`);
  }
  await page.evaluate(() => window.editor.setMarkdown("- [ ] First checkbox\n- [ ] Second checkbox"));
  await page.locator("input.cm-atomic-task-checkbox").nth(1).click();
  assert.equal(await page.evaluate(() => window.editor.getMarkdown()), "- [ ] First checkbox\n- [x] Second checkbox", "Checkbox clicks must still update only their own source marker");
  mkdirSync(output, { recursive: true });
  await page.screenshot({ path: resolve(output, "checkboxes.png") });
  console.log(`PASS: ${seeds.length} list variants keep their caret gap before typing and after deleting; checkbox controls preserve the correct Markdown.`);
} finally { await browser.close(); }
