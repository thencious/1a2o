type FocusState = {
  element: HTMLElement;
  scope: ParentNode;
  selector?: string;
  textSelection?: { start: number; end: number; backward: boolean };
  selection?: {
    start: number;
    end: number;
    direction: "forward" | "backward" | "none";
  };
  range?: Range;
};
export type WorkspaceDomState = {
  root?: HTMLElement;
  focus?: FocusState;
  scroll: Map<Element | Window, { x: number; y: number }>;
};
export function workspaceOwns(root: HTMLElement, node: Node) {
  let current: Node | null = node;
  while (current) {
    if (root.contains(current)) return true;
    if (
      current.nodeType === 1 &&
      (current as Element)
        .closest("[data-workspace-owner]")
        ?.getAttribute("data-workspace-owner") === root.dataset.workspacePage
    )
      return true;
    try {
      current = current.ownerDocument?.defaultView?.frameElement ?? null;
    } catch {
      return false;
    }
  }
  return false;
}
export function captureWorkspaceFocus(
  state: WorkspaceDomState,
  element: Element | null,
) {
  if (element?.nodeType !== 1) return;
  let target = element as HTMLElement;
  try {
    while (target.tagName === "IFRAME") {
      const active = (target as HTMLIFrameElement).contentDocument
        ?.activeElement;
      if (!active || active.tagName === "BODY") break;
      target = active as HTMLElement;
    }
  } catch {}
  if (["BODY", "HTML"].includes(target.tagName)) return;
  const scope =
    state.root?.ownerDocument === target.ownerDocument &&
    state.root.contains(target)
      ? state.root
      : target.ownerDocument;
  let selector = target.id ? `#${CSS.escape(target.id)}` : undefined;
  if (!selector) {
    for (const attribute of [
      "data-new-priority",
      "name",
      "aria-label",
      "data-task-id",
      "contenteditable",
    ]) {
      const value = target.getAttribute(attribute);
      if (value === null) continue;
      const candidate = `${target.tagName.toLowerCase()}[${attribute}="${CSS.escape(value)}"]`;
      if (scope.querySelectorAll(candidate).length === 1) {
        selector = candidate;
        break;
      }
    }
  }
  const focus: FocusState = { element: target, scope, selector };
  if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
    const input = target as HTMLInputElement;
    if (input.selectionStart !== null && input.selectionEnd !== null)
      focus.selection = {
        start: input.selectionStart,
        end: input.selectionEnd,
        direction: input.selectionDirection ?? "none",
      };
  } else if (target.isContentEditable) {
    const selection = target.ownerDocument.getSelection();
    if (selection?.rangeCount && target.contains(selection.anchorNode))
      focus.range = selection.getRangeAt(0).cloneRange();
    if (focus.range && target.contains(focus.range.endContainer)) {
      const prefix = target.ownerDocument.createRange();
      prefix.selectNodeContents(target);
      prefix.setEnd(focus.range.startContainer, focus.range.startOffset);
      const start = prefix.toString().length;
      prefix.setEnd(focus.range.endContainer, focus.range.endOffset);
      focus.textSelection = {
        start,
        end: prefix.toString().length,
        backward:
          selection?.anchorNode === focus.range.endContainer &&
          selection.anchorOffset === focus.range.endOffset,
      };
    }
  }
  state.focus = focus;
}
export function restoreWorkspaceDom(
  state: WorkspaceDomState,
  cancelled: () => boolean,
  completed: () => void = () => {},
) {
  const scroll = new Map(state.scroll),
    focus = state.focus;
  let frame = 0,
    attempts = 0;
  const restore = () => {
    if (cancelled()) {
      completed();
      return;
    }
    for (const [element, position] of scroll) {
      if ("isConnected" in element) {
        if (element.isConnected) {
          element.scrollLeft = position.x;
          element.scrollTop = position.y;
        }
      } else element.scrollTo(position.x, position.y);
    }
    if (focus) {
      const target = focus.element.isConnected
        ? focus.element
        : focus.selector
          ? focus.scope.querySelector<HTMLElement>(focus.selector)
          : null;
      if (
        (!target?.getClientRects().length ||
          (target as HTMLInputElement).disabled) &&
        attempts++ < 60
      ) {
        frame = requestAnimationFrame(restore);
        return;
      }
      if (target) {
        target.focus({ preventScroll: true });
        if (focus.selection) {
          const { start, end, direction } = focus.selection;
          try {
            (target as HTMLInputElement).setSelectionRange(
              start,
              end,
              direction,
            );
          } catch {}
        } else if (focus.textSelection && target.isContentEditable) {
          const point = (offset: number): [Node, number] => {
            const walker = target.ownerDocument.createTreeWalker(target, 4);
            let remaining = offset;
            let last: Node = target;
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
              last = node;
              const length = node.textContent?.length ?? 0;
              if (remaining <= length) return [node, remaining];
              remaining -= length;
            }
            return [
              last,
              last === target ? 0 : (last.textContent?.length ?? 0),
            ];
          };
          const start = point(focus.textSelection.start),
            end = point(focus.textSelection.end);
          const selection = target.ownerDocument.getSelection();
          if (focus.textSelection.backward)
            selection?.setBaseAndExtent(end[0], end[1], start[0], start[1]);
          else selection?.setBaseAndExtent(start[0], start[1], end[0], end[1]);
        } else if (
          focus.range?.startContainer.isConnected &&
          focus.range.endContainer.isConnected
        ) {
          const selection = target.ownerDocument.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(focus.range);
        }
      }
    }
    completed();
  };
  frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(restore);
  });
  return () => cancelAnimationFrame(frame);
}
