"use client";
import { useEffect, useRef, useState } from "react";
import { Clock3, Pause, Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AgentPanel, AgentTask } from "@/utils/agents/types";
import { command } from "./agent-command";

export function AgentScheduleCard({
  panel,
  task,
  index,
  refresh,
  onTerminalKey,
}: {
  panel: AgentPanel;
  task: AgentTask;
  index: number;
  refresh: () => Promise<unknown>;
  onTerminalKey: (key: string) => void;
}) {
  const [message, setMessage] = useState(task.message ?? panel.message),
    [delay, setDelay] = useState(task.delay),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [now, setNow] = useState(Date.now());
  const lastMessage = useRef(task.message ?? panel.message),
    saving = useRef(Promise.resolve());
  const running = ["running", "resuming"].includes(task.status);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const edit = () => {
    if (message === lastMessage.current) return saving.current;
    const operation = saving.current
      .catch(() => undefined)
      .then(async () => {
        await command({
          op: "edit_schedule",
          id: panel.id,
          taskId: task.id,
          settings: { message },
        });
        lastMessage.current = message;
      });
    saving.current = operation;
    return operation;
  };
  useEffect(() => {
    if (message === lastMessage.current) return;
    const timer = setTimeout(
      () => edit().catch((error) => setError(error.message)),
      400,
    );
    return () => clearTimeout(timer);
  }, [message, edit]);
  const hold = (active: boolean) =>
    command({ op: "editing", id: panel.id, taskId: task.id, active }).catch(
      () => {},
    );
  async function schedule() {
    setBusy(true);
    setError("");
    try {
      if (!message.trim()) throw new Error("Enter a message to schedule.");
      if (!delay.trim() || /^0+(?::0+)?$/.test(delay.trim()))
        throw new Error(
          "Choose a future delay. Enter schedules; it never sends now.",
        );
      if (
        delay === task.delay &&
        task.status === "scheduled" &&
        task.due !== null &&
        task.due <= Date.now() / 1000 + 5
      )
        throw new Error(
          "This scheduled time has passed. Set a new future delay before scheduling.",
        );
      await edit();
      if (delay !== task.delay || task.status !== "scheduled")
        await command({ op: "timer", id: panel.id, taskId: task.id, delay });
      await hold(false);
      await refresh();
      return true;
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not schedule the call.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function operate(op: "cancel" | "pause") {
    setBusy(true);
    setError("");
    try {
      if (op === "pause") await edit();
      await command({ op, id: panel.id, taskId: task.id });
      await refresh();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not change this schedule.",
      );
    } finally {
      setBusy(false);
    }
  }
  const remaining =
    task.status === "paused"
      ? task.remaining
      : task.due
        ? Math.max(0, task.due - now / 1000)
        : 0;
  const duration = [
    Math.floor(remaining / 3600),
    Math.floor(remaining / 60) % 60,
    Math.floor(remaining) % 60,
  ]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
  return (
    <section
      aria-label={`Scheduled call ${index + 1}`}
      data-command-context={JSON.stringify({
        tab: "agents",
        agentId: panel.id,
        taskId: task.id,
        title: panel.chat_title,
      })}
      className="rounded-md border bg-background p-2"
      onFocusCapture={() => hold(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          edit()
            .then(() => hold(false))
            .catch((error) => setError(error.message));
      }}
    >
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px]">
        <span className="font-medium">Call {index + 1}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {task.status}
          {task.due ? ` · ${new Date(task.due * 1000).toLocaleString()}` : ""}
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="size-6"
          aria-label={`${task.status === "paused" ? "Resume" : "Pause"} scheduled call ${index + 1}`}
          disabled={
            busy || running || !["scheduled", "paused"].includes(task.status)
          }
          onClick={() => operate("pause")}
        >
          {task.status === "paused" ? (
            <Play className="size-3" />
          ) : (
            <Pause className="size-3" />
          )}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-6"
          aria-label={`Cancel scheduled call ${index + 1}`}
          title="Cancel this scheduled call"
          disabled={busy || running}
          onClick={() => operate("cancel")}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      <div className="mb-1.5 flex items-center gap-2">
        <input
          aria-label={`Delay for call ${index + 1}`}
          className="h-7 w-20 rounded border bg-background px-1.5 text-xs"
          placeholder="h:mm"
          value={delay}
          disabled={busy || running}
          onChange={(event) => setDelay(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              const input = event.currentTarget;
              schedule().then((ok) => {
                if (ok) input.blur();
              });
            }
          }}
        />
        <span className="text-xs tabular-nums">{duration}</span>
        {(task.model || task.effort) && (
          <span className="ml-auto truncate text-[10px] text-muted-foreground">
            {task.model || "Default"} · {task.effort || "Default"}
          </span>
        )}
      </div>
      <div className="flex items-end gap-1.5">
        <textarea
          aria-label={`Message for call ${index + 1}`}
          rows={2}
          className="min-h-12 min-w-0 flex-1 resize-y rounded border bg-background px-2 py-1 text-xs"
          placeholder="Message to schedule…"
          value={message}
          disabled={busy || running}
          onChange={(event) => {
            setMessage(event.target.value);
            hold(true);
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (
              event.shiftKey &&
              ["ArrowLeft", "ArrowUp", "ArrowDown", "ArrowRight"].includes(
                event.key,
              )
            ) {
              event.preventDefault();
              onTerminalKey(event.key);
            } else if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              const input = event.currentTarget;
              schedule().then((ok) => {
                if (ok) input.blur();
              });
            }
          }}
        />
        <Button
          size="sm"
          className="h-8 gap-1 px-2 text-xs"
          disabled={busy || running || !message.trim()}
          onClick={() => schedule()}
        >
          <Clock3 className="size-3" />
          Schedule
        </Button>
      </div>
      {error || task.error ? (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error || task.error}
        </p>
      ) : null}
      <p className="mt-1 text-[10px] text-muted-foreground">
        Enter schedules · Shift+Enter adds a line
      </p>
    </section>
  );
}
