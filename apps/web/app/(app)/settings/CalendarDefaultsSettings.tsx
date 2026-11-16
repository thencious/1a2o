"use client";
import { useId, useState } from "react";
import useSWR from "swr";
import { useCalendarDefaults } from "@/hooks/useCalendarDefaults";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  calendarDefaults,
  type CalendarDefaults,
} from "@/utils/calendar/defaults";
import { saveCalendarDefaultsAction } from "@/utils/actions/calendar-defaults";
import { getActionErrorMessage } from "@/utils/error";
import type { MonthCalendar } from "@/utils/calendar/month-types";

export function CalendarDefaultsSettings() {
  const zoomInputId = useId();
  const { data, error, mutate } = useCalendarDefaults();
  const { data: catalog } = useSWR<{ calendars: MonthCalendar[] }>(
    "/api/user/calendar/catalog",
  );
  const [editing, setEditing] = useState<CalendarDefaults>();
  const [busy, setBusy] = useState(false),
    [failure, setFailure] = useState("");
  const value = editing ?? data;
  async function save() {
    if (!value || busy) return;
    setBusy(true);
    setFailure("");
    try {
      const parsed = calendarDefaults.safeParse(value);
      if (!parsed.success) throw new Error(parsed.error.issues[0].message);
      const result = await saveCalendarDefaultsAction(parsed.data);
      if (!result?.data) throw new Error(getActionErrorMessage(result ?? {}));
      await mutate(result.data, { revalidate: false });
      setEditing(undefined);
    } catch (error) {
      setFailure(
        error instanceof Error ? error.message : "Could not save defaults.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3 rounded-xl border p-4">
      <h3 className="text-sm font-medium">Calendar and meeting defaults</h3>
      <p className="text-xs text-muted-foreground">
        Used by /invite and New event in Calendars. Saved across restarts and
        devices.
      </p>
      {value ? (
        <>
          <label className="block space-y-1 text-sm">
            Default calendar
            <select
              aria-label="Default calendar"
              className="h-10 w-full rounded-md border bg-background px-3 text-foreground"
              value={value.defaultCalendarId ?? ""}
              onChange={(event) =>
                setEditing({
                  ...value,
                  defaultCalendarId: event.target.value || null,
                })
              }
            >
              <option value="">Automatic (writable primary calendar)</option>
              {value.defaultCalendarId &&
                !catalog?.calendars.some(
                  (calendar) => calendar.id === value.defaultCalendarId,
                ) && (
                  <option value={value.defaultCalendarId}>
                    Saved calendar (currently unavailable)
                  </option>
                )}
              {catalog?.calendars
                .filter((calendar) => calendar.writable)
                .map((calendar) => (
                  <option key={calendar.id} value={calendar.id}>
                    {calendar.name} — {calendar.accountEmail}
                  </option>
                ))}
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            Online meeting service
            <select
              aria-label="Online meeting service"
              className="h-10 w-full rounded-md border bg-background px-3 text-foreground"
              value={value.meetingProvider}
              onChange={(event) =>
                setEditing({
                  ...value,
                  meetingProvider: event.target
                    .value as CalendarDefaults["meetingProvider"],
                })
              }
            >
              <option value="google_meet">
                Google Meet (new link on Google calendars)
              </option>
              <option value="zoom">Zoom (saved personal meeting link)</option>
            </select>
          </label>
          <label htmlFor={zoomInputId} className="block space-y-1 text-sm">
            Zoom meeting link
            <Input
              id={zoomInputId}
              aria-label="Zoom meeting link"
              type="url"
              placeholder="https://zoom.us/j/…"
              value={value.zoomMeetingUrl}
              onChange={(event) =>
                setEditing({ ...value, zoomMeetingUrl: event.target.value })
              }
            />
          </label>
          <p className="text-xs text-muted-foreground">
            Zoom uses your personal meeting room link. Google Meet generates a
            new link and requires a Google calendar. A link already agreed in
            the conversation takes precedence.
          </p>
          <Button disabled={busy || !editing} onClick={save}>
            {busy ? "Saving…" : "Save defaults"}
          </Button>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          {error?.message ?? "Loading defaults…"}
        </p>
      )}
      {failure && (
        <p role="alert" className="text-sm text-destructive">
          {failure}
        </p>
      )}
    </section>
  );
}
