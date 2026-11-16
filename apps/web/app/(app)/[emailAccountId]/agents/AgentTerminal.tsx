"use client";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import "@xterm/xterm/css/xterm.css";
import { agentCommandAction } from "@/utils/actions/agents";
import { getActionErrorMessage } from "@/utils/error";

export type AgentTerminalHandle = {
  key: (data: string) => void;
  focus: () => void;
};
export const AgentTerminal = forwardRef<
  AgentTerminalHandle,
  {
    id: string;
    threadId: string;
    onError: (message: string) => void;
    onSession: (panel: {
      chat_id: string;
      chat_title: string;
      new_chat?: boolean;
    }) => void;
  }
>(function AgentTerminal({ id, threadId, onError, onSession }, ref) {
  const host = useRef<HTMLDivElement>(null),
    socket = useRef<WebSocket | null>(null),
    focus = useRef<() => void>(() => {});
  const retained = useRef<{ host: HTMLDivElement; dispose: () => void } | null>(
    null,
  );
  const errorHandler = useRef(onError);
  errorHandler.current = onError;
  const sessionHandler = useRef(onSession);
  sessionHandler.current = onSession;
  useImperativeHandle(
    ref,
    () => ({
      key: (data) => {
        if (socket.current?.readyState === WebSocket.OPEN)
          socket.current.send(JSON.stringify({ type: "input", data }));
      },
      focus: () => focus.current(),
    }),
    [],
  );
  useEffect(() => {
    if (!threadId || !host.current) return;
    const element = host.current;
    const disposeIfRemoved = () => {
      if (element.isConnected) return;
      retained.current?.dispose();
      retained.current = null;
    };
    if (retained.current?.host === element) return disposeIfRemoved;
    let disposed = false,
      cleanup: () => void = () => {};
    async function open() {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (disposed || !element.isConnected) return;
      const terminal = new Terminal({
        fontFamily: "Cascadia Mono, Consolas, monospace",
        fontSize: 12,
        cursorBlink: true,
        scrollback: 10_000,
        allowProposedApi: false,
        theme: {
          background: "#171717",
          foreground: "#d4d4d4",
          cursor: "#e5e5e5",
        },
      });
      const fit = new FitAddon();
      terminal.loadAddon(fit);
      terminal.open(element);
      focus.current = () => terminal.focus();
      const resize = () => {
        try {
          fit.fit();
          if (socket.current?.readyState === WebSocket.OPEN)
            socket.current.send(
              JSON.stringify({
                type: "resize",
                cols: terminal.cols,
                rows: terminal.rows,
              }),
            );
        } catch {}
      };
      const observer = new ResizeObserver(resize);
      observer.observe(element);
      let released = false;
      cleanup = () => {
        if (!released) {
          released = true;
          observer.disconnect();
          terminal.dispose();
        }
      };
      const result = await agentCommandAction({ op: "connect", id });
      if (disposed) {
        return;
      }
      if (!result?.data) {
        observer.disconnect();
        terminal.dispose();
        throw new Error(getActionErrorMessage(result ?? {}));
      }
      const endpoint = new URL((result.data as { url: string }).url);
      endpoint.host = window.location.host;
      endpoint.protocol =
        window.location.protocol === "https:" ? "wss:" : "ws:";
      endpoint.pathname = "/api/local-agents-terminal";
      const ws = new WebSocket(endpoint);
      socket.current = ws;
      const input = terminal.onData((data) => {
        if (ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ type: "input", data }));
      });
      terminal.attachCustomKeyEventHandler((event) => {
        if (event.type !== "keydown") return true;
        const keys: Record<string, string> = {
          ArrowLeft: "\x1b[1;2D",
          ArrowUp: "\x1b[1;2A",
          ArrowDown: "\x1b[1;2B",
          ArrowRight: "\x1b[1;2C",
          Enter: "\x1b[13;2u",
        };
        if (
          event.shiftKey &&
          !event.ctrlKey &&
          !event.altKey &&
          keys[event.key]
        ) {
          event.preventDefault();
          if (ws.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify({ type: "input", data: keys[event.key] }));
          return false;
        }
        return true;
      });
      ws.onopen = resize;
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === "output") terminal.write(message.data);
          if (message.type === "session") sessionHandler.current(message.panel);
          if (message.type === "error") errorHandler.current(message.message);
          if (message.type === "exit")
            terminal.write(
              `\r\n[CLI exited: ${message.code}. Use Reconnect to resume.]\r\n`,
            );
        } catch {}
      };
      ws.onerror = () =>
        errorHandler.current(
          "Terminal connection failed. Use Reconnect to try again.",
        );
      cleanup = () => {
        if (released) return;
        released = true;
        observer.disconnect();
        input.dispose();
        ws.close();
        terminal.dispose();
      };
      resize();
    }
    retained.current = {
      host: element,
      dispose: () => {
        disposed = true;
        cleanup();
        socket.current = null;
      },
    };
    open().catch((error) => {
      cleanup();
      if (!disposed) errorHandler.current(error.message);
    });
    return disposeIfRemoved;
  }, [id, threadId]);
  return (
    <div
      role="group"
      aria-label="Agent terminal"
      className="relative min-h-0 flex-1 overflow-hidden bg-[#171717] p-1"
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div ref={host} className="absolute inset-1" />
    </div>
  );
});
