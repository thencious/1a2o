"use client";

import { format, addDays } from "date-fns";
import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { dayEventLayout } from "@/utils/calendar/day-layout";
import type { MonthCalendar, MonthEvent } from "@/utils/calendar/month-types";
import type { useCalendarEventDrag } from "@/hooks/useCalendarEventDrag";

export function DayCalendarTimeline({
  day,
  events,
  calendars,
  colors,
  onClose,
  onDay,
  onOpen,
  onNew,
  drag,
}: {
  day: Date;
  events: MonthEvent[];
  calendars: MonthCalendar[];
  colors: Record<string, number>;
  onClose: () => void;
  onDay: (day: Date) => void;
  onOpen: (event: MonthEvent) => void;
  onNew: (hour: number) => void;
  drag: ReturnType<typeof useCalendarEventDrag>;
}) {
  const writable = calendars.some((calendar) => calendar.writable);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 480;
  }, []);
  const eventButton = (event: MonthEvent) => {
    const calendar = calendars.find((item) => item.id === event.calendarKey);
    const hue = colors[event.calendarKey] ?? 210;
    return (
      <button
        type="button"
        {...drag.eventProps(event, day, !event.allDay)}
        data-calendar-event-id={event.id}
        onClick={() => onOpen(event)}
        className={`h-full w-full overflow-hidden rounded border-l-2 px-2 py-1 text-left text-xs focus-visible:ring-2 focus-visible:ring-ring ${drag.eventProps(event, day).draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
        style={{
          background: `hsl(${hue} 40% 19%)`,
          color: `hsl(${hue} 65% 85%)`,
          borderColor: `hsl(${hue} 82% 60%)`,
        }}
      >
        <span className="block font-medium">{event.title}</span>
        {!event.allDay && (
          <span className="block opacity-80">
            {format(new Date(event.start), "HH:mm")}–
            {format(new Date(event.end), "HH:mm")}
          </span>
        )}
        <span className="block truncate opacity-70">{calendar?.name}</span>
      </button>
    );
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-4xl flex-col gap-3">
        <div className="flex items-center gap-2 pr-6">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous day"
            onClick={() => onDay(addDays(day, -1))}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <DialogTitle className="flex-1">
            {format(day, "EEEE, MMMM d, yyyy")}
          </DialogTitle>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next day"
            onClick={() => onDay(addDays(day, 1))}
          >
            <ChevronRight className="size-4" />
          </Button>
          <Button size="sm" disabled={!writable} onClick={() => onNew(9)}>
            <Plus className="mr-1 size-4" />
            New event
          </Button>
        </div>
        <DialogDescription className="sr-only">
          Calendar day timeline.
        </DialogDescription>
        {drag.message && (
          <p role="status" className="text-xs text-muted-foreground">
            {drag.message}
          </p>
        )}
        {drag.failure && (
          <p role="alert" className="text-xs text-destructive">
            {drag.failure.message}{" "}
            <button
              type="button"
              className="underline"
              disabled={drag.busy}
              onClick={drag.retry}
            >
              Retry
            </button>
          </p>
        )}
        <div
          role="region"
          className="min-h-0 overflow-y-auto"
          aria-label="Day timeline"
          ref={scrollRef}
        >
          <div className="flex gap-2 border-b p-2" {...drag.dropProps(day)}>
            <span className="w-12 shrink-0 text-xs text-muted-foreground">
              All day
            </span>
            <div className="grid flex-1 gap-1">
              {events
                .filter((event) => event.allDay)
                .map((event) => (
                  <div key={`${event.calendarKey}:${event.id}`}>
                    {eventButton(event)}
                  </div>
                ))}
            </div>
          </div>
          <div
            className="relative"
            data-calendar-timeline
            {...drag.dropProps(day, (event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              return (
                ((event.clientY - bounds.top) * 1440) /
                Math.max(1, bounds.height)
              );
            })}
            style={{ height: 1440 }}
          >
            {drag.target?.date === format(day, "yyyy-MM-dd") &&
              drag.target.minute !== undefined && (
                <div
                  className="pointer-events-none absolute left-14 right-0 z-20 border-t-2 border-muted-foreground"
                  style={{ top: drag.target.minute }}
                >
                  <span className="rounded bg-background px-1 text-xs">
                    {drag.target.blocked
                      ? "Read-only · Hold Alt to copy"
                      : drag.target.copy
                        ? "Copy"
                        : "Move"}{" "}
                    ·{" "}
                    {String(Math.floor(drag.target.minute / 60)).padStart(
                      2,
                      "0",
                    )}
                    :{String(drag.target.minute % 60).padStart(2, "0")}
                  </span>
                </div>
              )}
            {Array.from({ length: 24 }, (_, hour) => (
              <div
                key={hour}
                className="absolute inset-x-0 h-[60px] border-t"
                style={{ top: hour * 60 }}
              >
                <span className="absolute left-0 top-1 w-12 text-center text-xs text-muted-foreground">
                  {String(hour).padStart(2, "0")}:00
                </span>
                <button
                  type="button"
                  disabled={!writable}
                  aria-label={`New event at ${String(hour).padStart(2, "0")}:00`}
                  onClick={() => onNew(hour)}
                  className="absolute inset-y-0 left-14 right-0 hover:bg-muted/40 focus-visible:bg-muted/40"
                />
              </div>
            ))}
            {dayEventLayout(events, day).map((item) => (
              <div
                key={`${item.event.calendarKey}:${item.event.id}`}
                className="absolute z-10 pr-1"
                style={{
                  top: item.start,
                  height: Math.max(24, item.end - item.start),
                  left: `calc(56px + (100% - 56px) * ${item.lane / item.lanes})`,
                  width: `calc((100% - 56px) / ${item.lanes})`,
                }}
              >
                {eventButton(item.event)}
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
