"use client";

import useSWR from "swr";
import { useCalendarVisibility } from "@/hooks/useCalendarVisibility";
import { calendarColors } from "@/utils/calendar/month-utils";
import type { MonthCalendar } from "@/utils/calendar/month-types";
import { Button } from "@/components/ui/button";

export function CalendarArchiveSettings() {
  const { data, error, isLoading, mutate } = useSWR<{
    calendars: MonthCalendar[];
    warnings: string[];
  }>("/api/user/calendar/catalog");
  const calendars = data?.calendars ?? [];
  const preferences = useCalendarVisibility(calendars);
  const archived = preferences.hidden;
  const colors = calendarColors(calendars, archived);
  return (
    <div className="space-y-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Calendars shown in month view</h3>
        <Button
          size="sm"
          variant="ghost"
          disabled={
            preferences.loading || preferences.saving || !archived.length
          }
          onClick={preferences.showAll}
        >
          Show all
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={preferences.loading || preferences.saving}
          onClick={preferences.hideAll}
        >
          Hide all
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Across all accounts. Unchecked calendars are archived from the calendar
        list and month view. Check them to restore them. This does not delete
        calendars or change AI availability settings. Your choices are saved to
        your account across restarts and devices. Newly discovered calendars
        stay hidden until you enable them.
      </p>
      {preferences.error && (
        <p role="alert" className="text-sm text-destructive">
          {preferences.error}
        </p>
      )}
      {preferences.saving && (
        <p role="status" className="text-xs text-muted-foreground">
          Saving?
        </p>
      )}
      {isLoading && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading calendar checklistâ€¦
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          Could not load calendars.{" "}
          <button type="button" className="underline" onClick={() => mutate()}>
            Retry
          </button>
        </p>
      )}
      {data?.warnings.map((warning) => (
        <p key={warning} className="text-xs text-muted-foreground">
          {warning}
        </p>
      ))}
      <div className="space-y-2">
        {calendars.map((calendar) => {
          const hidden = archived.includes(calendar.id);
          return (
            <label
              key={calendar.id}
              className={`flex cursor-pointer items-start gap-2 rounded-md px-1 py-1.5 text-sm ${hidden ? "text-muted-foreground" : ""}`}
            >
              <input
                type="checkbox"
                aria-label={`Show ${calendar.name} (${calendar.accountEmail})`}
                checked={!hidden}
                disabled={preferences.loading || preferences.saving}
                onChange={(event) =>
                  preferences.toggle(calendar.id, event.target.checked)
                }
                className="mt-1"
              />
              <span
                aria-hidden="true"
                className="mt-1.5 size-2 shrink-0 rounded-full"
                style={{
                  background: hidden
                    ? "transparent"
                    : `hsl(${colors[calendar.id]} 82% 60%)`,
                }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{calendar.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {calendar.accountEmail}
                </span>
              </span>
              {hidden && (
                <span className="text-xs text-muted-foreground">Archived</span>
              )}
            </label>
          );
        })}
      </div>
      {!isLoading && !error && !calendars.length && (
        <p className="text-sm text-muted-foreground">
          Connect a calendar below to add it to this checklist.
        </p>
      )}
    </div>
  );
}
