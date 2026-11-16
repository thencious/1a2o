"use client";

import { useRef, useState, type DragEvent, type PointerEvent } from "react";
import { format } from "date-fns";
import type { MonthCalendar, MonthEvent } from "@/utils/calendar/month-types";
import { calendarDropInput } from "@/utils/calendar/event-drop";
import type { SaveMonthEvent } from "@/utils/actions/calendar-month.validation";
import { saveMonthEventAction } from "@/utils/actions/calendar-month";
import { getActionErrorMessage } from "@/utils/error";

export function useCalendarEventDrag(
  calendars: MonthCalendar[],
  onSaved: (
    event: MonthEvent,
    original: MonthEvent,
    copy: boolean,
  ) => Promise<void>,
  copyCalendarId?: string,
) {
  const source = useRef<{
    event: MonthEvent;
    day: Date;
    grabMinutes: number;
  } | null>(null);
  const pending = useRef(false);
  const grab = useRef<{ id: string; minute: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<{
    date: string;
    minute?: number;
    copy: boolean;
    blocked: boolean;
  }>();
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState<{
    message: string;
    input: SaveMonthEvent;
    event: MonthEvent;
    copy: boolean;
  }>();
  const save = async (
    input: SaveMonthEvent,
    event: MonthEvent,
    copy: boolean,
  ) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setFailure(undefined);
    setMessage(copy ? "Copying calendar item…" : "Moving calendar item…");
    try {
      const result = await saveMonthEventAction(input);
      if (!result?.data) throw new Error(getActionErrorMessage(result ?? {}));
      setMessage(copy ? "Calendar item copied." : "Calendar item moved.");
      try {
        await onSaved(
          {
            ...event,
            ...input,
            calendarKey:
              calendars.find(
                (calendar) =>
                  calendar.connectionId === input.connectionId &&
                  calendar.calendarId === input.calendarId,
              )?.id ?? event.calendarKey,
            id: result.data.id,
            etag: "",
            recurring: copy ? false : event.recurring,
            ...(copy
              ? {
                  descriptionLocked: false,
                  url: undefined,
                  conferenceUrl: undefined,
                }
              : {}),
          },
          event,
          copy,
        );
      } catch {
        setMessage("Saved. Refresh calendars to load the latest details.");
      }
    } catch (error) {
      setMessage("");
      setFailure({
        message:
          error instanceof Error
            ? error.message
            : "Could not save this calendar item.",
        input,
        event,
        copy,
      });
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const eventProps = (event: MonthEvent, day: Date, timeline = false) => ({
    draggable:
      !busy &&
      calendars.some(
        (calendar) =>
          calendar.writable &&
          (calendar.id === event.calendarKey || calendar.id === copyCalendarId),
      ),
    onPointerDown(pointer: PointerEvent<HTMLElement>) {
      grab.current = {
        id: event.id,
        minute: grabMinute(pointer.currentTarget, pointer.clientY, timeline),
      };
    },
    onDragStart(drag: DragEvent<HTMLElement>) {
      if (pending.current) {
        drag.preventDefault();
        return;
      }
      source.current = {
        event,
        day,
        grabMinutes:
          grab.current?.id === event.id
            ? grab.current.minute
            : grabMinute(drag.currentTarget, drag.clientY, timeline),
      };
      drag.dataTransfer.effectAllowed = "copyMove";
      drag.dataTransfer.setData("application/x-zenro-calendar-event", event.id);
    },
    onDragEnd() {
      source.current = null;
      grab.current = null;
      setTarget(undefined);
    },
  });
  const dropProps = (
    day: Date,
    minuteAt?: (drag: DragEvent<HTMLElement>) => number,
  ) => {
    const minute = (drag: DragEvent<HTMLElement>) =>
      minuteAt && source.current && !source.current.event.allDay
        ? Math.max(
            0,
            Math.min(
              1425,
              Math.round((minuteAt(drag) - source.current.grabMinutes) / 15) *
                15,
            ),
          )
        : undefined;
    return {
      onDragOver(drag: DragEvent<HTMLElement>) {
        if (!source.current || pending.current) return;
        drag.preventDefault();
        const item = source.current.event;
        const blocked =
          !drag.altKey &&
          (!item.editable ||
            !item.etag ||
            !calendars.some(
              (calendar) =>
                calendar.id === item.calendarKey && calendar.writable,
            ));
        drag.dataTransfer.dropEffect = blocked
          ? "none"
          : drag.altKey
            ? "copy"
            : "move";
        const next = {
          date: format(day, "yyyy-MM-dd"),
          minute: minute(drag),
          copy: drag.altKey,
          blocked,
        };
        setTarget((previous) =>
          previous?.date === next.date &&
          previous.minute === next.minute &&
          previous.copy === next.copy &&
          previous.blocked === next.blocked
            ? previous
            : next,
        );
      },
      onDragLeave(drag: DragEvent<HTMLElement>) {
        if (!drag.currentTarget.contains(drag.relatedTarget as Node | null))
          setTarget(undefined);
      },
      onDrop(drag: DragEvent<HTMLElement>) {
        const item = source.current;
        if (!item || pending.current) return;
        drag.preventDefault();
        drag.stopPropagation();
        const originalCalendar = calendars.find(
          (calendar) => calendar.id === item.event.calendarKey,
        );
        const calendar =
          drag.altKey && !originalCalendar?.writable
            ? calendars.find(
                (calendar) =>
                  calendar.id === copyCalendarId && calendar.writable,
              )
            : originalCalendar;
        const targetMinute = minute(drag);
        source.current = null;
        setTarget(undefined);
        if (!calendar) return;
        try {
          const input = calendarDropInput({
            event: item.event,
            calendar,
            from: item.day,
            to: day,
            minute: targetMinute,
            copy: drag.altKey,
            requestId: crypto.randomUUID(),
          });
          if (input) save(input, item.event, drag.altKey);
        } catch (error) {
          setMessage(
            error instanceof Error
              ? error.message
              : "Could not move this calendar item.",
          );
        }
      },
    };
  };
  return {
    eventProps,
    dropProps,
    target,
    busy,
    message,
    failure,
    retry: () => {
      if (failure) save(failure.input, failure.event, failure.copy);
    },
  };
}

function grabMinute(node: HTMLElement, y: number, timeline: boolean) {
  if (!timeline) return 0;
  const axis = node.closest("[data-calendar-timeline]");
  const scale = axis
    ? 1440 / Math.max(1, axis.getBoundingClientRect().height)
    : 1;
  return Math.max(0, (y - node.getBoundingClientRect().top) * scale);
}
