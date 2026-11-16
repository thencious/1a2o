// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "public/open-todo-zero/offline-host.js"),
  "utf8",
);
type EditorOptions = { el: HTMLElement; initialValue: string };

describe("workspace editor loading fallback", () => {
  it.each([
    "missing",
    "throws",
  ])("keeps the existing document available when the new engine %s", (mode) => {
    const element = document.createElement("div");
    const options = {
      el: element,
      initialValue: "# Existing note\nKeep every word.",
    };
    class LegacyEditor {
      options: EditorOptions;
      constructor(options: EditorOptions) {
        this.options = options;
      }
    }
    class BrokenEditor {
      constructor(input: EditorOptions) {
        input.el.textContent = "partial mount";
        throw new Error("Engine could not load");
      }
    }
    const host = {
      toastui: { Editor: LegacyEditor },
      WorkspaceMarkdownEditor: mode === "throws" ? BrokenEditor : undefined,
      WorkspaceEditor: undefined as unknown as new (
        input: typeof options,
      ) => LegacyEditor,
      dispatchEvent: vi.fn(),
    };
    new Function("window", "crypto", "location", source)(
      host,
      { randomUUID: () => "fixture" },
      { href: "http://localhost/test" },
    );
    const editor = new host.WorkspaceEditor(options);
    expect(editor).toBeInstanceOf(LegacyEditor);
    expect(editor.options.initialValue).toBe(
      "# Existing note\nKeep every word.",
    );
    expect(element.textContent).toBe("");
    expect(host.dispatchEvent).toHaveBeenCalledTimes(mode === "throws" ? 1 : 0);
  });
});
