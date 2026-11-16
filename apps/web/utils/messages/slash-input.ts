import { slashContextSchema, type SlashContext } from "./slash-context";
export function slashInput(target: EventTarget | null) {
  if (!target || (target as Node).nodeType !== 1) return null;
  const element = target as Element;
  if (
    element.closest(
      "[data-chat-composer],[data-slash-native],.xterm,[data-slash-ignore]",
    )
  )
    return null;
  const node = element.closest('textarea,input,[contenteditable="true"]');
  if (!node || node.getAttribute("aria-disabled") === "true") return null;
  if (
    node.tagName === "INPUT" &&
    !["text", "search"].includes((node as HTMLInputElement).type)
  )
    return null;
  if (
    (node.tagName === "INPUT" || node.tagName === "TEXTAREA") &&
    ((node as HTMLInputElement).disabled || (node as HTMLInputElement).readOnly)
  )
    return null;
  return node as HTMLInputElement | HTMLTextAreaElement | HTMLElement;
}
export function slashInputText(node: HTMLElement) {
  return node.tagName === "INPUT" || node.tagName === "TEXTAREA"
    ? (node as HTMLInputElement).value
    : node.innerText;
}
export function slashAtStart(node: HTMLElement) {
  if (node.tagName === "INPUT" || node.tagName === "TEXTAREA")
    return (node as HTMLInputElement).selectionStart === 0;
  const selection = node.ownerDocument.getSelection();
  if (!selection?.rangeCount || !node.contains(selection.anchorNode))
    return false;
  const before = selection.getRangeAt(0).cloneRange();
  before.selectNodeContents(node);
  before.setEnd(selection.anchorNode!, selection.anchorOffset);
  return !before.toString();
}
export function slashOrigin(
  node: HTMLElement,
  pathname: string,
  inherited: Record<string, string> = {},
): SlashContext {
  const doc = node.ownerDocument;
  const panel =
    node.closest("[data-workspace-page]") ??
    doc.querySelector('[data-workspace-active="true"]') ??
    doc.body;
  const contextual =
    node.closest("[data-command-context]") ??
    panel.querySelector("[data-command-context]");
  const selection: Record<string, string> = { ...inherited };
  const accountId = pathname.split("/")[1];
  if (accountId && !["settings", "shared", "organization"].includes(accountId))
    selection.emailAccountId = accountId;
  try {
    const data = JSON.parse(
      contextual?.getAttribute("data-command-context") ?? "{}",
    );
    for (const [key, value] of Object.entries(data))
      if (typeof value === "string")
        selection[key.slice(0, 100)] = value.slice(0, 2000);
  } catch {
    /* Navigation context remains useful without an item selection. */
  }
  const task = doc.querySelector<HTMLElement>(
    ".task-row.selected[data-task-id]",
  );
  const note = doc.querySelector<HTMLElement>(
    ".note-row.selected[data-note-id]",
  );
  if (task?.dataset.taskId) selection.taskId = task.dataset.taskId;
  if (note?.dataset.noteId) selection.noteId = note.dataset.noteId;
  if (note)
    selection.title = (note.querySelector("strong")?.textContent ?? "").slice(
      0,
      2000,
    );
  return slashContextSchema.parse({
    tab: inherited.tab ?? pathname.split("/")[2] ?? "settings",
    pathname,
    field: (
      node.getAttribute("aria-label") ||
      node.getAttribute("placeholder") ||
      node.id ||
      node.tagName.toLowerCase()
    ).slice(0, 200),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    capturedAt: new Date().toISOString(),
    selection,
  });
}
