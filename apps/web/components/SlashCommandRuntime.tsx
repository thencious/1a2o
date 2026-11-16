"use client";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useChat } from "@/providers/ChatProvider";
import { useSidebar } from "@/components/ui/sidebar";
import {
  slashChatEvent,
  slashContextSchema,
} from "@/utils/messages/slash-context";
import {
  slashInput,
  slashInputText,
  slashAtStart,
  slashOrigin,
} from "@/utils/messages/slash-input";

export function SlashCommandRuntime() {
  const pathname = usePathname();
  const {
    chat,
    input,
    setInput,
    setSourceContext,
    sourceContext,
    submitTextMessage,
  } = useChat();
  const { setOpen, setOpenMobile } = useSidebar();
  const pending = useRef<{
    text: string;
    context: ReturnType<typeof slashOrigin>;
  } | null>(null);
  useEffect(() => {
    const docs = new Map<Document, () => void>();
    const frames = new Map<HTMLIFrameElement, () => void>();
    const open = () => {
      const include = (names: string[]) =>
        names.includes("chat-sidebar") ? names : [...names, "chat-sidebar"];
      setOpen(include);
      setOpenMobile(include);
      const focus = (attempt = 0) => {
        const field = [
          ...document.querySelectorAll<HTMLTextAreaElement>(
            "[data-chat-composer]",
          ),
        ].find((item) => item.getClientRects().length);
        if (field?.getClientRects().length) {
          field.focus();
          field.setSelectionRange(field.value.length, field.value.length);
          pending.current = null;
        } else if (attempt < 120)
          requestAnimationFrame(() => focus(attempt + 1));
      };
      requestAnimationFrame(() => focus());
    };
    const route = (
      text: string,
      context: ReturnType<typeof slashOrigin>,
      submit = false,
    ) => {
      if (submit && chat.status !== "ready" && chat.status !== "error")
        return false;
      open();
      if (submit)
        submitTextMessage(text, context).catch(() => {
          setInput(text);
          setSourceContext(context);
        });
      else {
        if (input && !sourceContext) {
          try {
            sessionStorage.setItem("zenro:chat-preserved-draft", input);
          } catch {}
        }
        pending.current = { text, context };
        setInput(text);
        setSourceContext(context);
      }
      return true;
    };
    const external = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (typeof detail?.text !== "string" || !detail.text.startsWith("/"))
        return;
      const active =
        document.querySelector<HTMLElement>('[data-workspace-active="true"]') ??
        document.body;
      const context = slashOrigin(active, pathname, detail.selection ?? {});
      if (!slashContextSchema.safeParse(context).success) return;
      detail.accepted = route(detail.text, context, Boolean(detail.submit));
    };
    window.addEventListener(slashChatEvent, external);
    const attach = (doc: Document, frame?: HTMLIFrameElement) => {
      if (docs.has(doc)) return;
      const origin = (node: HTMLElement) =>
        slashOrigin(
          node,
          pathname,
          frame
            ? {
                tab: frame.src.includes("workspace=notes") ? "notes" : "todo",
                frame: frame.title,
              }
            : {},
        );
      const key = (event: KeyboardEvent) => {
        if (event.isComposing || event.ctrlKey || event.altKey || event.metaKey)
          return;
        if (
          pending.current &&
          (event.target as Element)?.getAttribute?.("data-chat-composer") ===
            null
        ) {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            event.stopImmediatePropagation();
            if (route(pending.current.text, pending.current.context, true))
              pending.current = null;
            return;
          }
          if (event.key.length === 1 || event.key === "Backspace") {
            event.preventDefault();
            event.stopImmediatePropagation();
            pending.current.text =
              event.key === "Backspace"
                ? pending.current.text.slice(0, -1)
                : pending.current.text + event.key;
            setInput(pending.current.text);
            return;
          }
        }
        const node = slashInput(event.target);
        if (!node) return;
        const text = slashInputText(node);
        if (event.key === "/" && slashAtStart(node)) {
          if (route("/", origin(node))) {
            event.preventDefault();
            event.stopImmediatePropagation();
          }
        } else if (
          event.key === "Enter" &&
          !event.shiftKey &&
          text.startsWith("/") &&
          text.trim().length > 1
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
          route(text, origin(node), true);
        }
      };
      const paste = (event: ClipboardEvent) => {
        const node = slashInput(event.target),
          text = event.clipboardData?.getData("text/plain") ?? "";
        if (
          node &&
          slashAtStart(node) &&
          text.startsWith("/") &&
          route(text, origin(node))
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      };
      doc.addEventListener("keydown", key, true);
      doc.addEventListener("paste", paste, true);
      docs.set(doc, () => {
        doc.removeEventListener("keydown", key, true);
        doc.removeEventListener("paste", paste, true);
      });
    };
    attach(document);
    const scan = () => {
      for (const frame of document.querySelectorAll<HTMLIFrameElement>(
        'iframe[src*="/api/user/todo/app"]',
      )) {
        if (frames.has(frame)) continue;
        const load = () => {
          try {
            if (frame.contentDocument) attach(frame.contentDocument, frame);
          } catch {}
        };
        frame.addEventListener("load", load);
        frames.set(frame, () => frame.removeEventListener("load", load));
        load();
      }
    };
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });
    scan();
    return () => {
      observer.disconnect();
      window.removeEventListener(slashChatEvent, external);
      for (const dispose of docs.values()) dispose();
      for (const dispose of frames.values()) dispose();
    };
  }, [
    pathname,
    chat.status,
    input,
    sourceContext,
    setInput,
    setSourceContext,
    submitTextMessage,
    setOpen,
    setOpenMobile,
  ]);
  return null;
}
