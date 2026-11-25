"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  saveTodoAction,
  analyzeTodoAction,
  getTodoPreferencesAction,
  saveTodoPreferencesAction,
  syncTodoCalendarAction,
  runTodoRemindersAction,
} from "@/utils/actions/todo";
import {
  saveNotesAction,
  noteToTaskAction,
  taskToNoteAction,
  analyzeNotesAction,
} from "@/utils/actions/notes";
import { getActionErrorMessage } from "@/utils/error";
import {
  saveTodo,
  analyzeTodo,
  todoPreferences,
  todoCalendarTask,
} from "@/utils/actions/todo.validation";
import type {
  CalendarPrompt,
  TodoCalendarResult,
} from "@/utils/todo/calendar-types";
import { TodoCalendarDialog } from "./TodoCalendarDialog";

export function TodoWorkspace({
  workspace = "tasks",
}: {
  workspace?: "tasks" | "notes";
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const bridge = useRef<{
    frame: HTMLIFrameElement;
    receive: (event: MessageEvent) => void;
  } | null>(null);
  const [prompts, setPrompts] = useState<CalendarPrompt[]>([]);
  const addPrompt = useCallback(
    (prompt: CalendarPrompt) =>
      setPrompts((current) => [
        ...current.filter((item) => item.taskId !== prompt.taskId),
        prompt,
      ]),
    [],
  );
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const disposeIfRemoved = () => {
      if (element.isConnected) return;
      if (bridge.current)
        window.removeEventListener("message", bridge.current.receive);
      bridge.current = null;
    };
    if (bridge.current?.frame === element) return disposeIfRemoved;
    if (workspace === "tasks")
      getTodoPreferencesAction()
        .then((result) => {
          for (const prompt of result?.data?.pending ?? []) addPrompt(prompt);
        })
        .catch(() => undefined);
    const receive = async (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== element.contentWindow ||
        event.data?.channel !== "inbox-todo"
      )
        return;
      if (event.data.type === "navigate") {
        element.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Tab",
            shiftKey: Boolean(event.data.shiftKey),
            bubbles: true,
            cancelable: true,
          }),
        );
        return;
      }
      const { id, type, input } = event.data;
      if (
        typeof id !== "string" ||
        ![
          "save",
          "analyze",
          "calendar",
          "preferences-save",
          "reminders",
          "note-to-task",
          "task-to-note",
        ].includes(type)
      )
        return;
      const source = element.contentWindow;
      try {
        const perform = async () => {
          switch (type) {
            case "save":
              return (workspace === "notes" ? saveNotesAction : saveTodoAction)(
                saveTodo.parse(input),
              );
            case "note-to-task":
              return noteToTaskAction(input);
            case "task-to-note":
              return taskToNoteAction(input);
            case "analyze":
              return (
                workspace === "notes" ? analyzeNotesAction : analyzeTodoAction
              )(analyzeTodo.parse(input));
            case "calendar":
              return syncTodoCalendarAction(todoCalendarTask.parse(input));
            case "preferences-save":
              return saveTodoPreferencesAction(
                todoPreferences.parse({
                  ...input,
                  taskUrl: window.location.href.split("?")[0],
                }),
              );
            default:
              return runTodoRemindersAction();
          }
        };
        const result = await perform();
        if (!result?.data) throw new Error(getActionErrorMessage(result ?? {}));
        if (type === "calendar") {
          const calendar = result.data as TodoCalendarResult;
          if (calendar.kind === "duplicate") addPrompt(calendar.prompt);
        }
        source?.postMessage(
          { channel: "inbox-todo-result", id, data: result.data },
          window.location.origin,
        );
      } catch (error) {
        source?.postMessage(
          {
            channel: "inbox-todo-result",
            id,
            error:
              error instanceof Error
                ? error.message
                : "Could not complete the checklist request.",
          },
          window.location.origin,
        );
      }
    };
    bridge.current = { frame: element, receive };
    window.addEventListener("message", receive);
    return disposeIfRemoved;
  }, [addPrompt, workspace]);
  return (
    <section
      aria-label={workspace === "notes" ? "Notes" : "Tasks"}
      className="flex min-h-0 flex-1 overflow-hidden bg-background"
    >
      <iframe
        ref={frame}
        src={`/api/user/todo/app?workspace=${workspace}&v=notes-1`}
        title={
          workspace === "notes" ? "1a2o notes" : "Open Todo Zero checklist"
        }
        className="h-full w-full border-0"
        allow="clipboard-write"
      />
      {prompts[0] && (
        <TodoCalendarDialog
          key={`${prompts[0].taskId}-${prompts[0].proposal.hash}`}
          prompt={prompts[0]}
          onClose={(message) => {
            if (message)
              frame.current?.contentWindow?.postMessage(
                { channel: "inbox-todo-notice", message },
                window.location.origin,
              );
            setPrompts((current) => current.slice(1));
          }}
        />
      )}
    </section>
  );
}
