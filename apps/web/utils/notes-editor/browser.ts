import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { redo, undo } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { basicSetup } from "codemirror";
import { atomicEditorTheme } from "../../vendor/obsidian-editor/src/atomic-theme";
import { obsidianMarkdown } from "../../vendor/obsidian-editor/src/obsidian/index";
import "../../vendor/obsidian-editor/src/styles/inline-preview.css";
import "../../vendor/obsidian-editor/src/obsidian/obsidian-tokens.css";
import "../../vendor/obsidian-editor/src/obsidian/embeds.css";
import "../../vendor/obsidian-editor/src/obsidian/footnotes.css";
import "../../vendor/obsidian-editor/src/obsidian/inlineTitle.css";
import "../../vendor/obsidian-editor/src/obsidian/linkFixes.css";
import "../../vendor/obsidian-editor/src/obsidian/math.css";
import "./host.css";

declare global {
  interface Window {
    toastui: {
      Editor: new (options: Record<string, unknown>) => { destroy: () => void };
    };
    WorkspaceMarkdownEditor: typeof WorkspaceMarkdownEditor;
  }
}

class WorkspaceMarkdownEditor {
  view: EditorView;
  mode = new Compartment();
  source = false;
  listeners = new Set<() => void>();
  options: {
    placeholder?: string;
    el: HTMLElement;
    documents?: () => { title: string; notes: string; id: string }[];
    openDocument?: (id: string) => void;
  };
  constructor(options: WorkspaceMarkdownEditor["options"]) {
    this.options = options;
    // Keep the existing toolbar's markup, icons and sizing while replacing
    // the editing engine. Destroy its old editor so there is only one live doc.
    const legacy = new window.toastui.Editor({
      ...options,
      initialEditType: "wysiwyg",
      hideModeSwitch: true,
      theme: "dark",
      usageStatistics: false,
      autofocus: false,
      toolbarItems: [
        ["heading", "bold", "italic"],
        ["ul", "ol", "task"],
        ["link", "code", "quote"],
      ],
    });
    const toolbar = options.el
      .querySelector(".toastui-editor-defaultUI-toolbar")!
      .cloneNode(true) as HTMLElement;
    // Notes initializes inside a hidden pane; discard the old editor's
    // zero-width overflow calculation rather than cloning hidden controls.
    for (const group of toolbar.querySelectorAll<HTMLElement>(
      ".toastui-editor-toolbar-group",
    ))
      group.style.removeProperty("display");
    toolbar.replaceChildren(
      ...[
        ...toolbar.querySelectorAll<HTMLElement>(
          ".toastui-editor-toolbar-group",
        ),
      ].filter((group) => !group.querySelector(".more")),
    );
    for (const button of toolbar.querySelectorAll<HTMLButtonElement>("button"))
      button.title = button.getAttribute("aria-label") || "";
    legacy.destroy();
    const frame = document.createElement("div");
    frame.className =
      "toastui-editor-defaultUI toastui-editor-dark workspace-markdown";
    const main = document.createElement("div");
    main.className = "toastui-editor-main md-obsidian";
    frame.append(toolbar, main);
    options.el.replaceChildren(frame);
    toolbar.addEventListener("mousedown", (event) => {
      if ((event.target as Element).closest(".toastui-editor-toolbar-icons"))
        event.preventDefault();
    });
    toolbar.addEventListener("click", (event) => {
      const button = (event.target as Element).closest(
        ".toastui-editor-toolbar-icons",
      );
      if (!button) return;
      const commands: Record<string, string> = {
        heading: "heading",
        bold: "bold",
        italic: "italic",
        "bullet-list": "ul",
        "ordered-list": "ol",
        "task-list": "task",
        link: "link",
        code: "code",
        quote: "quote",
      };
      const command = Object.entries(commands).find(([name]) =>
        button.classList.contains(name),
      )?.[1];
      if (command) this.exec(command);
    });
    this.view = new EditorView({ parent: main, state: this.state("") });
    this.view.dom.dataset.empty = "true";
    this.view.contentDOM.setAttribute("aria-label", "Note text");
    this.view.contentDOM.setAttribute("role", "textbox");
    this.view.contentDOM.setAttribute("aria-multiline", "true");
  }
  live() {
    const documents = () => this.options.documents?.() ?? [];
    const find = (target: string) =>
      documents().find(
        (note) => note.title.toLocaleLowerCase() === target.toLocaleLowerCase(),
      );
    return obsidianMarkdown({
      wikiLinks: {
        suggest: async (query) =>
          documents()
            .filter((note) =>
              note.title
                .toLocaleLowerCase()
                .includes(query.toLocaleLowerCase()),
            )
            .map((note) => ({ target: note.title, label: note.title })),
        resolve: async (target) => {
          const note = find(target);
          return note
            ? { target, label: note.title, status: "resolved" as const }
            : null;
        },
        onOpen: (target) => {
          const note = find(target);
          if (note) this.options.openDocument?.(note.id);
        },
        openOnClick: true,
      },
      embeds: { resolveEmbed: (target) => find(target)?.notes ?? null },
      onLinkClick: (url) => {
        try {
          const parsed = new URL(url, location.href);
          if (["https:", "http:", "mailto:"].includes(parsed.protocol))
            window.open(parsed.href, "_blank", "noopener,noreferrer");
        } catch {}
      },
    });
  }
  state(doc: string) {
    return EditorState.create({
      doc,
      extensions: [
        EditorView.contentAttributes.of({
          "data-placeholder": this.options.placeholder || "Title",
        }),
        this.mode.of(this.source ? this.raw() : this.live()),
        EditorView.updateListener.of((update) => {
          update.view.dom.dataset.empty = String(
            ["", "#"].includes(update.state.doc.toString().trim()),
          );
          if (update.docChanged)
            for (const listener of this.listeners) listener();
        }),
      ],
    });
  }
  raw() {
    // Use the same complete keyboard/search/history setup in both modes.
    return [
      basicSetup,
      EditorView.lineWrapping,
      atomicEditorTheme,
      markdown({ base: markdownLanguage }),
    ];
  }
  getMarkdown() {
    return this.view.state.doc.toString();
  }
  setMarkdown(value: string) {
    this.view.setState(this.state(value));
    this.view.dom.dataset.empty = String(["", "#"].includes(value.trim()));
  }
  setHTML(_value: string) {
    this.setMarkdown("# ");
  }
  on(event: string, listener: () => void) {
    if (event === "change") this.listeners.add(listener);
  }
  isMarkdownMode() {
    return this.source;
  }
  changeMode(mode: string) {
    this.source = mode === "markdown";
    this.view.dispatch({
      effects: this.mode.reconfigure(this.source ? this.raw() : this.live()),
    });
    this.view.focus();
  }
  focus() {
    this.view.focus();
  }
  moveCursorToStart() {
    this.setSelection(0, 0);
  }
  getSelection() {
    const { anchor, head } = this.view.state.selection.main;
    return [anchor, head];
  }
  setSelection(anchor: number, head: number) {
    const length = this.view.state.doc.length;
    this.view.dispatch({
      selection: EditorSelection.single(
        Math.min(anchor, length),
        Math.min(head, length),
      ),
    });
  }
  exec(command: string) {
    if (command === "undo") return undo(this.view);
    if (command === "redo") return redo(this.view);
    const { from, to } = this.view.state.selection.main;
    const doc = this.view.state.doc;
    if (command === "heading") {
      const menu = this.popover("Headings");
      for (let level = 1; level <= 6; level++) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = `Heading ${level}`;
        button.onclick = () => {
          menu.hidePopover();
          this.exec(`h${level}`);
        };
        menu.append(button);
      }
      menu.showPopover();
      return;
    }
    if (command === "link") {
      const popup = this.popover("Insert link");
      const form = document.createElement("form");
      const label = document.createElement("input");
      label.value = doc.sliceString(from, to);
      label.placeholder = "Link text";
      label.setAttribute("aria-label", "Link text");
      const url = document.createElement("input");
      url.type = "url";
      url.required = true;
      url.placeholder = "https://";
      url.setAttribute("aria-label", "Link URL");
      const add = document.createElement("button");
      add.type = "submit";
      add.textContent = "Insert link";
      form.append(label, url, add);
      popup.append(form);
      form.onsubmit = (event) => {
        event.preventDefault();
        this.view.dispatch({
          changes: {
            from,
            to,
            insert: `[${(label.value || url.value).replace(/[[\]]/g, "\\$&")}](${url.value.replace(/\)/g, "%29")})`,
          },
          userEvent: "input",
        });
        popup.hidePopover();
        this.view.focus();
      };
      popup.showPopover();
      url.focus();
      return;
    }
    let start = from,
      end = to,
      insert = doc.sliceString(from, to),
      caret = 0;
    const inline: Record<string, string> = {
      bold: "**",
      italic: "*",
      code: "`",
    };
    if (inline[command]) {
      const marker = inline[command];
      insert = marker + insert + marker;
      caret = marker.length;
    } else {
      start = doc.lineAt(from).from;
      end = doc.lineAt(to).to;
      const prefixes: Record<string, string> = {
        h1: "# ",
        h2: "## ",
        h3: "### ",
        h4: "#### ",
        h5: "##### ",
        h6: "###### ",
        ul: "- ",
        ol: "1. ",
        task: "- [ ] ",
        quote: "> ",
      };
      const prefix = prefixes[command];
      if (!prefix) return;
      insert = doc
        .sliceString(start, end)
        .split("\n")
        .map((line) =>
          command.startsWith("h")
            ? prefix + line.replace(/^#{1,6}\s+/, "")
            : line.startsWith(prefix)
              ? line.slice(prefix.length)
              : prefix + line,
        )
        .join("\n");
      caret = Math.min(prefix.length, insert.length);
    }
    this.view.dispatch({
      changes: { from: start, to: end, insert },
      selection: {
        anchor: start + caret,
        head: start + insert.length - (inline[command]?.length ?? 0),
      },
      userEvent: "input",
    });
    this.view.focus();
  }
  popover(label: string) {
    const popup = document.createElement("div");
    popup.className = "workspace-editor-popover";
    popup.setAttribute("popover", "auto");
    popup.setAttribute("aria-label", label);
    const rect = this.options.el.getBoundingClientRect();
    popup.style.left = `${Math.max(8, Math.min(rect.left + 8, innerWidth - 240))}px`;
    popup.style.top = `${rect.top + 42}px`;
    this.options.el.append(popup);
    popup.addEventListener("toggle", (event) => {
      if ((event as ToggleEvent).newState === "closed") popup.remove();
    });
    return popup;
  }
}
window.WorkspaceMarkdownEditor = WorkspaceMarkdownEditor;
