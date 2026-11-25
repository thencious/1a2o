"use client";
import { useEffect, useRef, useState, type HTMLAttributes } from "react";
import useSWR from "swr";
import { Clock3, Plus, RefreshCw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { command } from "./agent-command";
import {
  AGENT_PANEL_ORDER_KEY,
  readPanelOrder,
  orderedAgentPanels,
  moveAgentPanel,
} from "@/utils/agents/panel-order";
import { AgentScheduleCard } from "./AgentScheduleCard";

import type {
  AgentPanel,
  AgentTask,
  AgentsState,
  AgentsMetadata,
} from "@/utils/agents/types";
import { AgentTerminal, type AgentTerminalHandle } from "./AgentTerminal";

async function read<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not load Agents.");
  return data;
}

export function AgentsWorkspace() {
  const { data, error, mutate } = useSWR<AgentsState>(
    "/api/user/agents",
    (url) => read<AgentsState>(url),
    { refreshInterval: 2000, revalidateOnFocus: true },
  );
  const {
    data: metadata,
    error: metadataError,
    mutate: refreshMetadata,
  } = useSWR<AgentsMetadata>(
    "/api/user/agents/metadata",
    (url) => read<AgentsMetadata>(url),
    { refreshInterval: 15_000, revalidateOnFocus: true },
  );
  const [panelOrder, setPanelOrder] = useState<string[]>(() => {
    try {
      return readPanelOrder(localStorage.getItem(AGENT_PANEL_ORDER_KEY));
    } catch {
      return [];
    }
  });
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const dragFromControl = useRef(false);
  const [failure, setFailure] = useState("");
  const [adding, setAdding] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const existingPanels = useRef(new Set<string>());
  const preparedChat = useRef<Promise<AgentPanel> | null>(null);
  const preparationGeneration = useRef(0);
  const openPicker = () => {
    setSearch("");
    setFailure("");
    setPickerOpen(true);
    refreshMetadata();
    const generation = ++preparationGeneration.current;
    const preparation: Promise<AgentPanel> = (async () => {
      const panel = await command<AgentPanel>({ op: "add" });
      try {
        const fresh = await command<AgentPanel>({ op: "new", id: panel.id });
        if (preparationGeneration.current === generation) await mutate();
        return fresh;
      } catch (error) {
        await command({ op: "remove", id: panel.id }).catch(() => {});
        throw error;
      }
    })();
    preparedChat.current = preparation;
    preparation.catch((error) => setFailure(error.message));
  };
  const closePicker = () => {
    setPickerOpen(false);
    preparationGeneration.current++;
    const preparation = preparedChat.current;
    preparedChat.current = null;
    preparation
      ?.then((panel) => command({ op: "remove", id: panel.id }))
      .then(() => mutate())
      .catch((error) => setFailure(error.message));
  };
  const add = async (chatId: string | null) => {
    existingPanels.current = new Set(data?.panels.map((panel) => panel.id));
    setAdding(true);
    let panel: AgentPanel | undefined;
    try {
      panel =
        (await preparedChat.current) ??
        (await command<AgentPanel>({ op: "add" }));
      if (chatId) {
        await command({
          op: "configure",
          id: panel.id,
          settings: { chat_id: chatId },
        });
      } else if (!panel.new_chat) {
        await command({ op: "new", id: panel.id });
      }
      await mutate();
      preparedChat.current = null;
      setPickerOpen(false);
      setFailure("");
    } catch (error) {
      setFailure((error as Error).message);
      preparedChat.current = null;
      if (panel) {
        await command({ op: "remove", id: panel.id }).catch(() => {});
        await mutate();
      }
    } finally {
      setAdding(false);
    }
  };
  const panels = orderedAgentPanels(
    data?.panels.filter(
      (panel) => !adding || existingPanels.current.has(panel.id),
    ) ?? [],
    panelOrder,
  );
  const finishDrag = () => {
    setDraggingId(null);
    setDropTarget(null);
  };
  const reorder = (target: string) => {
    if (!draggingId) return;
    const next = moveAgentPanel(
      panels.map((panel) => panel.id),
      draggingId,
      target,
    );
    setPanelOrder(next);
    try {
      localStorage.setItem(AGENT_PANEL_ORDER_KEY, JSON.stringify(next));
    } catch {}
    finishDrag();
  };
  const query = search.trim().toLowerCase();
  const chats = metadata?.chats.filter((chat) =>
    `${chat.title} ${chat.cwd} ${chat.model} ${chat.id}`
      .toLowerCase()
      .includes(query),
  );
  return (
    <section
      aria-label="Agents workspace"
      className="flex min-h-0 flex-1 flex-col gap-3 p-3"
    >
      <header className="flex shrink-0 items-center gap-3">
        <h1 className="text-xl font-semibold">Agents</h1>
        <span className="mr-auto text-xs text-muted-foreground">
          {panels?.length ?? 0} panels
        </span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Refresh agents"
          onClick={() => {
            mutate();
            refreshMetadata();
          }}
        >
          <RefreshCw className="size-4" />
        </Button>
        <Button size="sm" disabled={adding} onClick={openPicker}>
          <Plus className="mr-1 size-4" />
          Add agent
        </Button>
      </header>
      {(error || failure) && (
        <p role="alert" className="text-sm text-destructive">
          {failure || error?.message}
        </p>
      )}
      {!data && !error && <p role="status">Loading agents…</p>}
      {data && !panels?.length && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed text-muted-foreground">
          <p>Add an agent, then choose a conversation or start a new one.</p>
          <Button variant="outline" onClick={openPicker}>
            <Plus className="mr-1 size-4" />
            Add agent
          </Button>
        </div>
      )}
      {!!panels?.length && (
        <div
          className="agents-grid grid min-h-0 flex-1 gap-3 overflow-auto px-2"
          style={{
            gridTemplateColumns: `repeat(${Math.min(4, panels.length)},minmax(0,1fr))`,
            gridAutoRows: "minmax(360px,1fr)",
          }}
        >
          {panels.map((panel, index) => (
            <AgentPane
              key={`${panel.id}:${panel.new_chat ? "new" : panel.chat_id}`}
              panel={panel}
              isDragging={draggingId === panel.id}
              dropSide={
                dropTarget === panel.id && draggingId && draggingId !== panel.id
                  ? panels.findIndex((item) => item.id === draggingId) > index
                    ? "before"
                    : "after"
                  : undefined
              }
              dragHandleProps={{
                draggable: panels.length > 1,
                title: "Drag to reorder agent panels",
                onPointerDownCapture: (event) => {
                  dragFromControl.current = !!(event.target as Element).closest(
                    "button, input, select, textarea, a",
                  );
                },
                onDragStart: (event) => {
                  if (dragFromControl.current) {
                    event.preventDefault();
                    return;
                  }
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData(
                    "application/x-zenro-agent-panel",
                    panel.id,
                  );
                  setDraggingId(panel.id);
                },
                onDragEnd: finishDrag,
              }}
              dropProps={{
                onDragOver: (event) => {
                  if (!draggingId) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setDropTarget(panel.id);
                },
                onDragLeave: (event) => {
                  if (
                    !event.currentTarget.contains(
                      event.relatedTarget as Node | null,
                    )
                  )
                    setDropTarget(null);
                },
                onDrop: (event) => {
                  if (
                    !draggingId ||
                    event.dataTransfer.getData(
                      "application/x-zenro-agent-panel",
                    ) !== draggingId
                  )
                    return;
                  event.preventDefault();
                  event.stopPropagation();
                  reorder(panel.id);
                },
              }}
              metadata={metadata}
              tasks={(
                panel.taskIds ?? (panel.taskId ? [panel.taskId] : [])
              ).flatMap((id) =>
                data?.tasks.find((task) => task.id === id)
                  ? [data.tasks.find((task) => task.id === id)!]
                  : [],
              )}
              refresh={() => mutate()}
            />
          ))}
        </div>
      )}
      <Dialog
        open={pickerOpen}
        onOpenChange={(open) => {
          if (!adding && !open) closePicker();
        }}
      >
        <DialogContent
          className="flex max-h-[85dvh] w-[calc(100vw_-_2rem)] max-w-3xl flex-col overflow-hidden rounded-lg p-4 sm:p-6"
          hideCloseButton={adding}
        >
          <DialogHeader className="shrink-0 pr-7 text-left">
            <DialogTitle>Choose a conversation</DialogTitle>
            <DialogDescription>
              Open a saved conversation as an agent, or start a new one.
            </DialogDescription>
          </DialogHeader>
          <label className="flex shrink-0 items-center gap-2 rounded-md border bg-background px-3">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              aria-label="Search conversations"
              placeholder="Search conversations or folders..."
              className="h-10 min-w-0 flex-1 border-0 bg-transparent px-0 text-sm shadow-none outline-none focus:ring-0"
              value={search}
              disabled={adding}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          {failure && (
            <p role="alert" className="text-sm text-destructive">
              {failure}
            </p>
          )}
          <section
            aria-label="Conversations"
            className="min-h-0 space-y-2 overflow-y-auto p-1"
          >
            <button
              type="button"
              disabled={adding}
              onClick={() => add(null)}
              className="flex w-full items-center gap-3 rounded-lg border border-foreground/20 bg-foreground/[0.08] p-4 text-left text-foreground transition-colors hover:bg-foreground/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              <Plus className="size-5 shrink-0" />
              <span>
                <span className="block text-sm font-semibold">New chat</span>
                <span className="block text-xs opacity-75">
                  Open a fresh, empty chat
                </span>
              </span>
            </button>
            {!metadata && !metadataError && (
              <p role="status" className="p-4 text-sm text-muted-foreground">
                Loading conversations...
              </p>
            )}
            {metadataError && (
              <div role="alert" className="p-3 text-sm text-destructive">
                Could not refresh conversations.
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => refreshMetadata()}
                >
                  Retry
                </Button>
              </div>
            )}
            {chats?.map((chat) => (
              <button
                key={chat.id}
                type="button"
                disabled={adding}
                onClick={() => add(chat.id)}
                className="block w-full space-y-1 rounded-lg border bg-card p-4 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                <span className="block break-words text-sm font-medium">
                  {chat.title || "Untitled conversation"}
                </span>
                <span
                  className="block truncate text-xs text-muted-foreground"
                  title={chat.cwd}
                >
                  {chat.cwd}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {chat.model || "Default model"} · {chat.id.slice(-8)}
                </span>
              </button>
            ))}
            {metadata && !chats?.length && (
              <p className="p-4 text-sm text-muted-foreground">
                {query
                  ? "No conversations match your search."
                  : "No saved conversations yet."}
              </p>
            )}
          </section>
          {adding && (
            <p role="status" className="shrink-0 text-sm text-muted-foreground">
              Opening agent...
            </p>
          )}
        </DialogContent>
      </Dialog>
      <style>
        {
          "@media(max-width:1100px){.agents-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}}@media(max-width:640px){.agents-grid{grid-template-columns:minmax(0,1fr)!important}}"
        }
      </style>
    </section>
  );
}

function AgentPane({
  panel,
  metadata,
  tasks,
  refresh,
  isDragging,
  dropSide,
  dragHandleProps,
  dropProps,
}: {
  isDragging: boolean;
  dropSide?: "before" | "after";
  dragHandleProps: HTMLAttributes<HTMLElement>;
  dropProps: HTMLAttributes<HTMLElement>;
  panel: AgentPanel;
  metadata?: AgentsMetadata;
  tasks: AgentTask[];
  refresh: () => Promise<unknown>;
}) {
  const [values, setValues] = useState(panel),
    [failure, setFailure] = useState(""),
    [busy, setBusy] = useState(false),
    [generation, setGeneration] = useState(0);
  const [controlsVisible, setControlsVisible] = useState(false);

  const terminal = useRef<AgentTerminalHandle>(null),
    saved = useRef(JSON.stringify(panel));
  // Conversation metadata owns the name; panel state only owns editable settings.
  const chatTitle =
    metadata?.chats.find((chat) => chat.id === values.chat_id)?.title ||
    values.chat_title;
  const settings = {
    chat_id: values.chat_id,
    chat_title: chatTitle,
    cwd: values.cwd,
    model: values.model,
    effort: values.effort,
    message: values.message,
    cwd_manual: values.cwd_manual,
  };
  const serialized = JSON.stringify(settings);
  useEffect(() => {
    if (serialized === saved.current) return;
    const timer = setTimeout(() => {
      command({
        op: "configure",
        id: panel.id,
        settings: JSON.parse(serialized),
      })
        .then(() => {
          saved.current = serialized;
        })
        .catch((error) => setFailure(error.message));
    }, 500);
    return () => clearTimeout(timer);
  }, [serialized, panel.id]);
  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setFailure("");
    try {
      await operation();
      await refresh();
    } catch (error) {
      setFailure((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const flush = () =>
    command<AgentPanel>({ op: "configure", id: panel.id, settings });
  const selectChat = async (value: string) =>
    run(async () => {
      if (value === "__new__") {
        await flush();
        const created = await command<AgentPanel>({ op: "new", id: panel.id });
        setValues(created);
      } else {
        const updated = await command<AgentPanel>({
          op: "configure",
          id: panel.id,
          settings: { chat_id: value },
        });
        setValues(updated);
        setGeneration((value) => value + 1);
      }
    });
  const addSchedule = () =>
    run(async () => {
      await flush();
      await command({ op: "timer", id: panel.id, append: true });
    });
  const toggleControls = () => {
    if (controlsVisible) {
      setControlsVisible(false);
      return;
    }
    setControlsVisible(true);
    if (!tasks.length && values.chat_id) return addSchedule();
  };
  const field =
    "h-7 min-w-0 rounded border bg-background px-1.5 py-0 text-xs leading-normal";
  const tasksBusy = tasks.some((task) =>
    ["running", "resuming"].includes(task.status),
  );
  const mutate = (change: Partial<AgentPanel>) =>
    setValues((value) => ({ ...value, ...change }));
  return (
    <div {...dropProps} className="relative flex min-h-0 min-w-0">
      {dropSide && (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-1 z-20 w-0.5 rounded-full bg-foreground/70 ${dropSide === "before" ? "-left-[7px]" : "-right-[7px]"}`}
        />
      )}
      <article
        aria-label={`Agent panel ${chatTitle}`}
        className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card ${isDragging ? "opacity-50" : ""}`}
      >
        <header
          {...dragHandleProps}
          className="flex h-8 shrink-0 cursor-grab select-none items-center gap-1 border-b px-2 active:cursor-grabbing"
        >
          <span className="min-w-0 flex-1 truncate text-xs" title={chatTitle}>
            {chatTitle}
          </span>
          <Button
            variant={controlsVisible ? "secondary" : "ghost"}
            size="icon"
            className="size-6"
            aria-label="Timer and agent settings"
            aria-expanded={controlsVisible}
            aria-controls={`agent-controls-${panel.id}`}
            title="Show or hide timer, settings, and message input"
            disabled={busy}
            onClick={toggleControls}
          >
            <Clock3 className="size-3.5" />
          </Button>
          <span className="text-[10px] text-muted-foreground" role="status">
            {tasks.length
              ? `${tasks.length} scheduled call${tasks.length === 1 ? "" : "s"}`
              : values.chat_id
                ? "Connected"
                : "Choose chat"}
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="size-6"
            aria-label={
              controlsVisible
                ? "Cancel schedules and close scheduler"
                : "Close agent panel"
            }
            title={
              controlsVisible
                ? "Cancel all scheduled calls and close scheduler"
                : "Close agent panel"
            }
            disabled={busy || tasksBusy}
            onClick={() =>
              run(async () => {
                if (controlsVisible) {
                  await command({ op: "cancel_all", id: panel.id });
                  setControlsVisible(false);
                } else await command({ op: "remove", id: panel.id });
              })
            }
          >
            <X className="size-3.5" />
          </Button>
        </header>
        {failure && (
          <p
            role="alert"
            className="max-h-16 shrink-0 overflow-auto px-2 py-1 text-xs text-destructive"
          >
            {failure}
          </p>
        )}
        <div
          id={`agent-controls-${panel.id}`}
          hidden={!controlsVisible}
          className="max-h-[60vh] shrink-0 space-y-1.5 overflow-y-auto border-b p-2"
        >
          <div className="flex flex-wrap items-center gap-1">
            <select
              aria-label="Agent chat"
              value={values.chat_id}
              disabled={busy || tasksBusy}
              onChange={(event) => selectChat(event.target.value)}
              className={`${field} w-full flex-1 basis-36`}
            >
              <option value="">Choose chat…</option>
              {values.chat_id &&
                !metadata?.chats.some((chat) => chat.id === values.chat_id) && (
                  <option value={values.chat_id}>{chatTitle}</option>
                )}
              {metadata?.chats.map((chat) => (
                <option key={chat.id} value={chat.id}>
                  {chat.title} · {chat.id.slice(-8)}
                </option>
              ))}
              {!values.chat_id && <option value="__new__">+ New chat</option>}
            </select>
            <select
              aria-label="Agent model"
              value={values.model}
              disabled={tasksBusy}
              onChange={(event) => mutate({ model: event.target.value })}
              className={`${field} max-w-full flex-1 basis-24`}
            >
              <option value="">Default model</option>
              {Array.from(
                new Set([
                  ...Object.keys(metadata?.levels ?? {}),
                  ...(values.model ? [values.model] : []),
                ]),
              ).map((model) => (
                <option key={model}>{model}</option>
              ))}
            </select>
            <select
              aria-label="Thinking level"
              value={values.effort}
              disabled={tasksBusy}
              onChange={(event) => mutate({ effort: event.target.value })}
              className={`${field} w-24`}
            >
              <option>Default</option>
              {(
                metadata?.levels[values.model] ?? [
                  "low",
                  "medium",
                  "high",
                  "xhigh",
                  "max",
                ]
              ).map((level) => (
                <option key={level}>{level}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
            Folder
            <input
              aria-label="Working folder"
              disabled={tasksBusy}
              className={`${field} flex-1`}
              value={values.cwd}
              onChange={(event) =>
                mutate({ cwd: event.target.value, cwd_manual: true })
              }
            />
          </label>
          <p className="text-[10px] text-muted-foreground">
            Defaults for new calls. Each call keeps its own message and time.
          </p>
          {tasks.map((task, index) => (
            <AgentScheduleCard
              key={task.id}
              panel={{ ...values, chat_title: chatTitle }}
              task={task}
              index={index}
              refresh={refresh}
              onTerminalKey={(key) => {
                terminal.current?.key(
                  {
                    ArrowLeft: "\x1b[1;2D",
                    ArrowUp: "\x1b[1;2A",
                    ArrowDown: "\x1b[1;2B",
                    ArrowRight: "\x1b[1;2C",
                  }[key]!,
                );
                terminal.current?.focus();
              }}
            />
          ))}
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-1 text-xs"
            disabled={busy || !values.chat_id}
            onClick={addSchedule}
          >
            <Plus className="size-3" />
            Add scheduled call{tasks.length ? " (+1 hour)" : ""}
          </Button>
        </div>
        {values.chat_id || values.new_chat ? (
          <AgentTerminal
            key={generation}
            ref={terminal}
            id={panel.id}
            threadId={values.chat_id || "new"}
            onError={setFailure}
            onSession={(session) =>
              setValues((value) =>
                value.chat_id === session.chat_id
                  ? value
                  : { ...value, ...session },
              )
            }
          />
        ) : (
          <div className="flex min-h-20 flex-1 items-center justify-center px-4 text-center text-xs text-muted-foreground">
            Use the clock above to choose a chat and open its CLI here.
          </div>
        )}
      </article>
    </div>
  );
}
