"use client";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { resolveTodoCalendarAction } from "@/utils/actions/todo";
import { getActionErrorMessage } from "@/utils/error";
import type { CalendarPrompt } from "@/utils/todo/calendar-types";

export function TodoCalendarDialog({
  prompt,
  onClose,
}: {
  prompt: CalendarPrompt;
  onClose: (message?: string) => void;
}) {
  const [selected, setSelected] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const candidate = prompt.candidates[selected];
  const time = (value: string, allDay = false) =>
    allDay
      ? new Date(`${value}T12:00:00Z`).toLocaleDateString(undefined, {
          timeZone: "UTC",
          dateStyle: "medium",
        })
      : new Date(value).toLocaleString(undefined, {
          timeZone: prompt.proposal.timezone,
          dateStyle: "medium",
          timeStyle: "short",
        });
  async function choose(decision: "update" | "keep" | "skip" | "create") {
    setBusy(true);
    setError("");
    try {
      const result = await resolveTodoCalendarAction({
        taskId: prompt.taskId,
        hash: prompt.proposal.hash,
        decision,
        eventId: candidate?.event.id,
        calendarKey: candidate?.calendar.id,
        etag: candidate?.event.etag,
      });
      if (!result?.data) throw new Error(getActionErrorMessage(result ?? {}));
      onClose(
        decision === "create" || decision === "update"
          ? "Calendar event saved."
          : decision === "keep"
            ? "Using the existing calendar event."
            : "Calendar suggestion skipped.",
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not update the calendar.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Update an existing calendar event?</DialogTitle>
          <DialogDescription>
            A possible duplicate was found for “{prompt.taskTitle}”. Nothing new
            has been added.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md border border-border p-3 text-sm">
          <p className="font-medium">{prompt.proposal.title}</p>
          <p className="mt-1 text-muted-foreground">
            {prompt.proposal.allDay
              ? `${time(prompt.proposal.start, true)} · All day`
              : `${time(prompt.proposal.start)} → ${time(prompt.proposal.end)}`}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {prompt.proposal.timezone}
          </p>
        </div>
        {prompt.candidates.length > 0 && (
          <>
            <label
              htmlFor="todo-existing-event"
              className="text-sm font-medium"
            >
              Existing event
            </label>
            <select
              id="todo-existing-event"
              className="w-full rounded-md border border-input bg-background p-2 text-sm"
              value={selected}
              onChange={(event) => setSelected(Number(event.target.value))}
            >
              {prompt.candidates.map((item, index) => (
                <option
                  key={`${item.calendar.id}-${item.event.id}`}
                  value={index}
                >
                  {item.event.title} · {item.calendar.name} (
                  {item.calendar.accountEmail})
                </option>
              ))}
            </select>
            {candidate && (
              <p className="text-sm text-muted-foreground">
                {time(candidate.event.start, candidate.event.allDay)} →{" "}
                {time(candidate.event.end, candidate.event.allDay)}
                {!candidate.event.editable || !candidate.calendar.writable
                  ? " · Read-only"
                  : ""}
              </p>
            )}
          </>
        )}
        {prompt.otherTasks.length > 0 && (
          <div className="text-sm">
            <p className="font-medium">Similar tasks on these days</p>
            <ul className="mt-1 list-disc pl-5 text-muted-foreground">
              {prompt.otherTasks.map((title, index) => (
                <li key={`${title}-${index}`}>{title}</li>
              ))}
            </ul>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => choose("create")}
          >
            Create separate event
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => choose("skip")}
          >
            Skip this task
          </Button>
          {candidate && (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => choose("keep")}
              >
                Keep existing
              </Button>
              <Button
                size="sm"
                disabled={
                  busy ||
                  !candidate.calendar.writable ||
                  !candidate.event.editable
                }
                onClick={() => choose("update")}
              >
                {busy ? "Saving…" : "Update event"}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
