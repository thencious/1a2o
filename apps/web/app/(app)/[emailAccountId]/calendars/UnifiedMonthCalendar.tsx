"use client";

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import {
  addDays,
  addMonths,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
} from "date-fns";
import { ChevronLeft, ChevronRight, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DayCalendarTimeline } from "./DayCalendarTimeline";
import {
  calendarColors,
  compareMonthEvents,
  eventOnDay,
  monthDays,
} from "@/utils/calendar/month-utils";
import type { MonthEvent } from "@/utils/calendar/month-types";
import { MonthEventEditor } from "./MonthEventEditor";
import { useCalendarVisibility } from "@/hooks/useCalendarVisibility";
import { useCalendarMonth } from "@/hooks/useCalendarMonth";
import { useCalendarDefaults } from "@/hooks/useCalendarDefaults";
import { useCalendarEventDrag } from "@/hooks/useCalendarEventDrag";
import { preferredCalendar } from "@/utils/calendar/defaults";

export function UnifiedMonthCalendar({ userId }: { userId: string }) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [editor, setEditor] = useState<{
    key: string;
    day: Date;
    event?: MonthEvent;
    copyOf?: MonthEvent;
    hour?: number;
  }>();
  const [agenda, setAgenda] = useState<Date>();
  const days = monthDays(month);
  const params = new URLSearchParams({
    start: days[0].toISOString(),
    end: addDays(days.at(-1)!, 1).toISOString(),
  });
  const { data, error, isLoading, isValidating, mutate } = useCalendarMonth(
    userId,
    params,
  );
  const calendars = data?.calendars ?? [];
  const { data: defaults } = useCalendarDefaults();
  const { hidden } = useCalendarVisibility(calendars);
  const colors = calendarColors(calendars, hidden);
  const visible = calendars.filter((calendar) => !hidden.includes(calendar.id));
  const visibleIds = new Set(visible.map((calendar) => calendar.id));
  const creationCalendars = calendars.filter(
    (calendar) =>
      visibleIds.has(calendar.id) ||
      calendar.id === defaults?.defaultCalendarId,
  );
  const drag = useCalendarEventDrag(
    calendars,
    async (saved, original, copy) => {
      await mutate(
        (current) =>
          current
            ? {
                ...current,
                events: [
                  ...current.events.filter(
                    (event) =>
                      copy ||
                      event.id !== original.id ||
                      event.calendarKey !== original.calendarKey,
                  ),
                  saved,
                ],
              }
            : current,
        { revalidate: false },
      );
      await mutate();
    },
    preferredCalendar(creationCalendars, defaults?.defaultCalendarId ?? null)
      ?.id,
  );
  const events = (data?.events ?? []).filter((event) =>
    visibleIds.has(event.calendarKey),
  );
  const newEvent = (day: Date, hour = 9) =>
    setEditor({ key: crypto.randomUUID(), day, hour });
  const openEvent = (event: MonthEvent, day: Date) => {
    setEditor({ key: crypto.randomUUID(), day, event });
  };
  const forDay = (day: Date) =>
    events.filter((event) => eventOnDay(event, day)).sort(compareMonthEvents);
  const chip = (event: MonthEvent, day: Date, full = false) => {
    const calendar = calendars.find((item) => item.id === event.calendarKey);
    return (
      <button
        key={`${event.calendarKey}:${event.id}`}
        type="button"
        {...drag.eventProps(event, day)}
        data-calendar-event-id={event.id}
        title={`${event.title}\n${calendar?.name} · ${calendar?.accountEmail}`}
        onClick={() => openEvent(event, day)}
        className={`block w-full truncate rounded px-1.5 py-1 text-left text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 ${drag.eventProps(event, day).draggable ? "cursor-grab active:cursor-grabbing" : ""} ${full ? "py-2" : ""}`}
        style={eventStyle(colors[event.calendarKey] ?? 210)}
      >
        <span className="mr-1 opacity-75">
          {event.allDay ? "All day" : format(new Date(event.start), "HH:mm")}
        </span>
        {event.title}
        {event.ruleLabel && (
          <span className="ml-1 rounded bg-black/15 px-1 text-[10px]">
            {event.ruleLabel}
          </span>
        )}
        {full && (
          <span className="ml-2 opacity-70">
            {calendar?.name} · {calendar?.accountEmail}
          </span>
        )}
      </button>
    );
  };
  return (
    <section
      aria-label="Unified monthly calendar"
      data-command-context={JSON.stringify({
        tab: "calendars",
        date: (agenda ?? editor?.day ?? month).toISOString(),
        eventId: editor?.event?.id ?? "",
      })}
      className="mt-6 rounded-xl border bg-background"
    >
      <div className="flex flex-wrap items-center gap-2 border-b p-4">
        <h2 className="mr-auto text-xl font-semibold" aria-live="polite">
          {format(month, "MMMM yyyy")}
        </h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setMonth(startOfMonth(new Date()))}
        >
          Today
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Previous month"
          onClick={() => setMonth((previous) => addMonths(previous, -1))}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Next month"
          onClick={() => setMonth((previous) => addMonths(previous, 1))}
        >
          <ChevronRight className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Refresh calendars"
          disabled={isValidating}
          onClick={() => mutate()}
        >
          <RefreshCw
            className={`size-4 ${isValidating ? "animate-spin" : ""}`}
          />
        </Button>
        <Button
          size="sm"
          disabled={!creationCalendars.some((calendar) => calendar.writable)}
          onClick={() =>
            newEvent(isSameMonth(month, new Date()) ? new Date() : month)
          }
        >
          <Plus className="mr-1 size-4" />
          New event
        </Button>
      </div>
      {(drag.message || drag.failure) && (
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-xs text-muted-foreground">
          {drag.message && <span role="status">{drag.message}</span>}
          {drag.failure && (
            <span role="alert" className="text-destructive">
              {drag.failure.message}{" "}
              <button
                type="button"
                className="underline"
                disabled={drag.busy}
                onClick={drag.retry}
              >
                Retry
              </button>
            </span>
          )}
        </div>
      )}
      <div className="flex flex-col lg:flex-row">
        <aside
          aria-label="Active calendars"
          className="w-full shrink-0 space-y-3 border-b p-4 lg:w-56 lg:border-b-0 lg:border-r"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">All accounts</h3>
            <Link
              href="/settings#calendar-settings"
              className="text-xs text-muted-foreground underline"
            >
              Manage
            </Link>
          </div>
          {isLoading && (
            <p role="status" className="text-sm text-muted-foreground">
              Loading calendars…
            </p>
          )}
          {visible.map((calendar) => (
            <div key={calendar.id} className="flex items-start gap-2 text-sm">
              <span
                aria-hidden="true"
                className="mt-1.5 size-2 shrink-0 rounded-full"
                style={{
                  background: `hsl(${colors[calendar.id]} 82% 60%)`,
                }}
              />
              <span className="min-w-0">
                <span className="block truncate">{calendar.name}</span>
                <span
                  className="block truncate text-xs text-muted-foreground"
                  title={calendar.accountEmail}
                >
                  {calendar.accountEmail}
                </span>
                {!calendar.writable && (
                  <span className="text-[10px] text-muted-foreground">
                    Read-only
                  </span>
                )}
              </span>
            </div>
          ))}
          {!isLoading && !error && !calendars.length && (
            <p className="text-sm text-muted-foreground">
              No calendars available. Add or reconnect calendars under User →
              Settings → Calendars.
            </p>
          )}
          {!isLoading && !!calendars.length && !visible.length && (
            <p className="text-xs text-muted-foreground">
              All calendars are archived. Restore them in User → Settings →
              Calendars.
            </p>
          )}
        </aside>
        <div className="min-w-0 flex-1">
          {error && (
            <div role="alert" className="border-b p-3 text-sm text-destructive">
              Could not load calendars.{" "}
              <button
                type="button"
                className="underline"
                onClick={() => mutate()}
              >
                Retry
              </button>
            </div>
          )}
          {!!data?.warnings.length && (
            <div
              role="status"
              className="space-y-1 border-b p-3 text-xs text-muted-foreground"
            >
              {data.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          )}
          <div className="overflow-x-auto" aria-busy={isLoading}>
            <div className="min-w-[620px]">
              <div className="grid grid-cols-7 border-b text-center text-xs text-muted-foreground">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                  (name) => (
                    <div key={name} className="py-2">
                      {name}
                    </div>
                  ),
                )}
              </div>
              <div className="grid grid-cols-7">
                {days.map((day) => {
                  const items = forDay(day);
                  return (
                    <div
                      role="group"
                      key={day.toISOString()}
                      {...drag.dropProps(day)}
                      data-calendar-day={format(day, "yyyy-MM-dd")}
                      aria-label={format(day, "EEEE, MMMM d, yyyy")}
                      className={`relative flex min-h-32 min-w-0 flex-col gap-1 border-b border-r p-1.5 [&:nth-child(7n)]:border-r-0 ${isSameMonth(day, month) ? "" : "bg-muted/20"} ${drag.target?.date === format(day, "yyyy-MM-dd") ? "bg-muted/60 outline outline-2 -outline-offset-2 outline-muted-foreground" : ""}`}
                    >
                      {drag.target?.date === format(day, "yyyy-MM-dd") && (
                        <span className="pointer-events-none absolute right-2 top-2 rounded bg-background px-1 text-[10px] text-muted-foreground">
                          {drag.target.blocked
                            ? "Read-only · Hold Alt to copy"
                            : drag.target.copy
                              ? "Copy here"
                              : "Move here"}
                        </span>
                      )}
                      <button
                        type="button"
                        aria-label={`Open day ${format(day, "MMMM d, yyyy")}`}
                        onClick={() => setAgenda(day)}
                        className={`flex size-7 items-center justify-center rounded-full text-xs ${isToday(day) ? "bg-foreground text-background" : isSameMonth(day, month) ? "text-foreground hover:bg-muted" : "text-muted-foreground"}`}
                      >
                        {format(day, "d")}
                      </button>
                      {items.slice(0, 3).map((event) => chip(event, day))}
                      <div className="mt-auto flex h-6 items-center justify-between">
                        {items.length > 3 ? (
                          <button
                            type="button"
                            onClick={() => setAgenda(day)}
                            className="px-1 text-xs text-muted-foreground hover:underline"
                          >
                            +{items.length - 3} more
                          </button>
                        ) : (
                          <span />
                        )}
                        <button
                          type="button"
                          aria-label={`New event on ${format(day, "MMMM d, yyyy")}`}
                          disabled={
                            !visible.some((calendar) => calendar.writable)
                          }
                          onClick={() => newEvent(day)}
                          className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                        >
                          <Plus className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          {!isLoading && !error && !events.length && (
            <p className="p-3 text-center text-xs text-muted-foreground">
              {visible.length
                ? "No events in the selected calendars this month."
                : "Restore a calendar in User → Settings → Calendars to show its events."}
            </p>
          )}
        </div>
      </div>
      {editor && (
        <MonthEventEditor
          key={editor.key}
          calendars={editor.event ? calendars : creationCalendars}
          event={editor.event}
          copyOf={editor.copyOf}
          day={editor.day}
          initialHour={editor.hour}
          onClose={() => setEditor(undefined)}
          onSaved={() => {
            setEditor(undefined);
            mutate();
          }}
          onCopy={(event) =>
            setEditor({
              key: crypto.randomUUID(),
              day: editor.day,
              copyOf: event,
            })
          }
        />
      )}
      {agenda && !editor && (
        <DayCalendarTimeline
          key={agenda.toISOString()}
          day={agenda}
          events={forDay(agenda)}
          calendars={visible}
          colors={colors}
          drag={drag}
          onClose={() => setAgenda(undefined)}
          onDay={(day) => {
            setAgenda(day);
            if (!isSameMonth(day, month)) setMonth(startOfMonth(day));
          }}
          onOpen={(event) => openEvent(event, agenda)}
          onNew={(hour) => newEvent(agenda, hour)}
        />
      )}
    </section>
  );
}

function eventStyle(hue: number): CSSProperties {
  return {
    background: `hsl(${hue} 40% 19%)`,
    color: `hsl(${hue} 65% 85%)`,
    borderLeft: `3px solid hsl(${hue} 82% 60%)`,
  };
}
