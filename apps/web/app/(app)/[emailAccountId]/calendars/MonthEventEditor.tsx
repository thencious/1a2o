"use client";

import { useId, useState } from "react";
import { addDays, addHours, format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  saveMonthEventAction,
  deleteMonthEventAction,
} from "@/utils/actions/calendar-month";
import { getActionErrorMessage } from "@/utils/error";
import type { MonthCalendar, MonthEvent } from "@/utils/calendar/month-types";
import { saveMonthEventBody } from "@/utils/actions/calendar-month.validation";
import { useCalendarDefaults } from "@/hooks/useCalendarDefaults";
import {
  preferredCalendar,
  type CalendarDefaults,
} from "@/utils/calendar/defaults";

export function MonthEventEditor(
  props: Omit<Parameters<typeof MonthEventForm>[0], "defaults">,
) {
  const { data, error, mutate } = useCalendarDefaults();
  if (!data)
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) props.onClose();
        }}
      >
        <DialogContent>
          <DialogTitle>Calendar settings</DialogTitle>
          <DialogDescription>
            {error?.message ?? "Loading your default calendar…"}
          </DialogDescription>
          {error && <Button onClick={() => mutate()}>Retry</Button>}
        </DialogContent>
      </Dialog>
    );
  return <MonthEventForm {...props} defaults={data} />;
}

function MonthEventForm({
  calendars,
  event,
  copyOf,
  day,
  initialHour = 9,
  onClose,
  onSaved,
  onCopy,
  defaults,
  draft,
}: {
  calendars: MonthCalendar[];
  event?: MonthEvent;
  copyOf?: MonthEvent;
  day: Date;
  initialHour?: number;
  onClose: () => void;
  onSaved: () => void;
  onCopy: (event: MonthEvent) => void;
  defaults: CalendarDefaults;
  draft?: {
    title: string;
    description: string;
    location: string;
    start: string | null;
    end: string | null;
    guests: string[];
    conference: "none" | "google_meet" | "zoom";
    warnings: string[];
    mode: "physical" | "online" | "unspecified";
    candidateEmails: string[];
  };
}) {
  const inputId = useId();
  const [requestId] = useState(() => crypto.randomUUID());
  const [form, setForm] = useState(() => {
    const source = event ?? copyOf;
    const calendarKey =
      event?.calendarKey ??
      calendars.find(
        (calendar) => calendar.id === copyOf?.calendarKey && calendar.writable,
      )?.id ??
      preferredCalendar(
        draft?.conference === "google_meet" && !defaults.defaultCalendarId
          ? calendars.filter((calendar) => calendar.provider === "google")
          : calendars,
        defaults.defaultCalendarId,
      )?.id ??
      "";
    const _date = format(day, "yyyy-MM-dd");
    const initialStart = new Date(
      day.getFullYear(),
      day.getMonth(),
      day.getDate(),
      initialHour,
    );
    return {
      calendarKey,
      title:
        draft?.title ??
        (copyOf ? `${copyOf.title} (copy)` : (event?.title ?? "")),
      description: draft?.description ?? source?.description ?? "",
      location: draft?.location ?? source?.location ?? "",
      conference:
        draft?.conference ?? ("none" as "none" | "google_meet" | "zoom"),
      allDay: source?.allDay ?? false,
      guests: draft?.guests.join(", ") ?? event?.guests.join(", ") ?? "",
      start: draft
        ? draft.start
          ? format(new Date(draft.start), "yyyy-MM-dd'T'HH:mm")
          : ""
        : source
          ? source.allDay
            ? source.start
            : format(new Date(source.start), "yyyy-MM-dd'T'HH:mm")
          : format(initialStart, "yyyy-MM-dd'T'HH:mm"),
      end: draft
        ? draft.end
          ? format(new Date(draft.end), "yyyy-MM-dd'T'HH:mm")
          : ""
        : source
          ? source.allDay
            ? format(
                addDays(new Date(`${source.end}T00:00:00`), -1),
                "yyyy-MM-dd",
              )
            : format(new Date(source.end), "yyyy-MM-dd'T'HH:mm")
          : format(addHours(initialStart, 1), "yyyy-MM-dd'T'HH:mm"),
    };
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const calendar = calendars.find((item) => item.id === form.calendarKey);
  const editable = event
    ? event.editable && Boolean(event.etag)
    : Boolean(calendar?.writable);
  const deletable = Boolean(
    event && (event.deletable ?? event.editable) && event.etag,
  );
  const change = (field: keyof typeof form, value: string | boolean) =>
    setForm((previous) => ({ ...previous, [field]: value }));
  const remove = async () => {
    if (!calendar || !event || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await deleteMonthEventAction({
        connectionId: calendar.connectionId,
        calendarId: calendar.calendarId,
        eventId: event.id,
        etag: event.etag,
      });
      if (!result?.data) throw new Error(getActionErrorMessage(result ?? {}));
      onSaved();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not delete this event.",
      );
    } finally {
      setBusy(false);
    }
  };
  const save = async (submission: React.FormEvent) => {
    submission.preventDefault();
    if (!calendar || busy) return;
    setError("");
    try {
      const body = {
        connectionId: calendar.connectionId,
        calendarId: calendar.calendarId,
        eventId: event?.id,
        etag: event?.etag,
        requestId,
        title: form.title,
        description: form.description,
        location: form.location,
        allDay: form.allDay,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        start: form.allDay ? form.start : new Date(form.start).toISOString(),
        end: form.allDay
          ? format(addDays(new Date(`${form.end}T00:00:00`), 1), "yyyy-MM-dd")
          : new Date(form.end).toISOString(),
        guests: [
          ...new Set(
            form.guests
              .split(/[\s,;]+/)
              .map((value) => value.trim())
              .filter(Boolean),
          ),
        ],
        conference: form.conference,
      };
      if (draft && !body.guests.length) {
        setError(
          "Add at least one guest email address to send the invitation.",
        );
        return;
      }
      if (draft && form.conference === "none" && !form.location.trim()) {
        setError(
          "Enter a physical location or choose an online meeting service.",
        );
        return;
      }
      const parsed = saveMonthEventBody.safeParse(body);
      if (!parsed.success) {
        setError(
          parsed.error.issues[0]?.message ?? "Check this event's details.",
        );
        return;
      }
      setBusy(true);
      const result = await saveMonthEventAction(parsed.data);
      if (!result?.data) throw new Error(getActionErrorMessage(result ?? {}));
      onSaved();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not save this event.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto">
        <DialogTitle>
          {event
            ? editable
              ? "Edit event"
              : "Event details"
            : copyOf
              ? "Create editable copy"
              : draft
                ? "Review meeting invitation"
                : "New event"}
        </DialogTitle>
        <DialogDescription>
          {copyOf
            ? "The original stays on its calendar. Guests are not copied or notified."
            : event?.recurring
              ? "Changes apply to this occurrence only."
              : "Across all your connected accounts."}{" "}
          Times shown in {Intl.DateTimeFormat().resolvedOptions().timeZone}.
        </DialogDescription>
        {event?.conferenceUrl && /^https:\/\//.test(event.conferenceUrl) && (
          <a
            href={event.conferenceUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm underline"
          >
            Join meeting
          </a>
        )}
        {defaults.defaultCalendarId &&
          !event &&
          !copyOf &&
          !calendars.some(
            (calendar) =>
              calendar.id === defaults.defaultCalendarId && calendar.writable,
          ) && (
            <p className="text-xs text-destructive" role="alert">
              Your saved default calendar is unavailable. Choose the calendar
              below before saving.
            </p>
          )}
        {draft && (
          <div
            className="space-y-1 text-xs text-muted-foreground"
            role="status"
          >
            <p>
              Extracted from the last 50 conversation lines. Check the details
              below. Saving sends calendar invitations to the listed guests.
            </p>
            {draft.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        )}
        <form onSubmit={save} className="space-y-4">
          <fieldset
            disabled={busy || !editable}
            className="space-y-4 disabled:opacity-80"
          >
            <label
              htmlFor={`${inputId}-title`}
              className="block space-y-1 text-sm"
            >
              Title
              <Input
                id={`${inputId}-title`}
                autoFocus
                required
                maxLength={512}
                value={form.title}
                onChange={(e) => change("title", e.target.value)}
              />
            </label>
            <label className="block space-y-1 text-sm">
              Meeting
              <select
                aria-label="Meeting service"
                className="h-10 w-full rounded-md border bg-background px-3 text-foreground"
                value={form.conference}
                onChange={(event) => change("conference", event.target.value)}
              >
                <option value="none">
                  In person / existing link in Location
                </option>
                <option value="google_meet">Google Meet</option>
                <option value="zoom">Zoom (saved personal meeting link)</option>
              </select>
            </label>
            <label className="block space-y-1 text-sm">
              Calendar
              <select
                aria-label="Event calendar"
                className="h-10 w-full rounded-md border bg-background px-3 text-foreground"
                disabled={Boolean(event)}
                required
                value={form.calendarKey}
                onChange={(e) => change("calendarKey", e.target.value)}
              >
                {calendars
                  .filter(
                    (item) => item.writable || item.id === event?.calendarKey,
                  )
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} — {item.accountEmail}
                    </option>
                  ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.allDay}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setForm((previous) => ({
                    ...previous,
                    allDay: checked,
                    start: `${previous.start.slice(0, 10)}${checked ? "" : "T09:00"}`,
                    end: `${previous.end.slice(0, 10)}${checked ? "" : "T10:00"}`,
                  }));
                }}
              />
              All day
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label htmlFor={`${inputId}-start`} className="space-y-1 text-sm">
                Start
                <Input
                  aria-label="Event start"
                  id={`${inputId}-start`}
                  required
                  type={form.allDay ? "date" : "datetime-local"}
                  value={form.start}
                  onChange={(e) => change("start", e.target.value)}
                />
              </label>
              <label htmlFor={`${inputId}-end`} className="space-y-1 text-sm">
                {form.allDay ? "Last day" : "End"}
                <Input
                  aria-label="Event end"
                  id={`${inputId}-end`}
                  required
                  type={form.allDay ? "date" : "datetime-local"}
                  value={form.end}
                  onChange={(e) => change("end", e.target.value)}
                />
              </label>
            </div>
            <label
              htmlFor={`${inputId}-location`}
              className="block space-y-1 text-sm"
            >
              Location
              <Input
                id={`${inputId}-location`}
                maxLength={2000}
                value={form.location}
                onChange={(e) => change("location", e.target.value)}
              />
            </label>
            <label
              htmlFor={`${inputId}-guests`}
              className="block space-y-1 text-sm"
            >
              Guests
              <Input
                id={`${inputId}-guests`}
                placeholder="Email addresses, separated by commas"
                value={form.guests}
                onChange={(e) => change("guests", e.target.value)}
              />
            </label>
            {draft && draft.candidateEmails.length > 1 && (
              <div className="flex flex-wrap gap-1">
                {draft.candidateEmails.map((email) => (
                  <Button
                    type="button"
                    key={email}
                    size="sm"
                    variant="outline"
                    onClick={() => change("guests", email)}
                  >
                    {email}
                  </Button>
                ))}
              </div>
            )}
            <label
              htmlFor={`${inputId}-notes`}
              className="block space-y-1 text-sm"
            >
              Notes
              <Textarea
                id={`${inputId}-notes`}
                rows={5}
                disabled={event?.descriptionLocked}
                maxLength={20_000}
                value={form.description}
                onChange={(e) => change("description", e.target.value)}
              />
            </label>
          </fieldset>
          {event?.descriptionLocked && (
            <p className="text-xs text-muted-foreground">
              Edit online meeting notes in Outlook to preserve its meeting link.
            </p>
          )}
          {!editable && (
            <p className="text-sm text-muted-foreground">
              {event?.readOnlyReason ??
                "This calendar or invitation is read-only here. Open the event with its provider for more options."}
            </p>
          )}
          {!editable && (
            <a
              href="/settings#calendar-settings"
              className="block text-sm text-muted-foreground underline"
            >
              Calendar connection settings
            </a>
          )}
          {form.guests.trim() && (
            <p className="text-xs text-muted-foreground">
              Saving changes or deleting a meeting can notify its guests.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {confirmDelete ? (
            <div className="space-y-3 rounded-md border border-destructive/40 p-3">
              <p className="text-sm">
                Delete {event?.recurring ? "this occurrence" : "this event"}{" "}
                from this calendar? If you organize a meeting, guests may
                receive a cancellation.
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="destructive"
                  disabled={busy}
                  onClick={remove}
                >
                  {busy ? "Deleting…" : "Confirm delete"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setConfirmDelete(false)}
                >
                  Keep event
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {event && deletable && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete
                </Button>
              )}
              {event && calendars.some((calendar) => calendar.writable) && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => onCopy(event)}
                >
                  Create editable copy
                </Button>
              )}
              {event?.url && /^https:\/\//i.test(event.url) && (
                <a
                  className="text-sm text-muted-foreground underline"
                  target="_blank"
                  rel="noreferrer"
                  href={event.url}
                >
                  Open in{" "}
                  {calendar?.provider === "microsoft"
                    ? "Outlook"
                    : "Google Calendar"}
                </a>
              )}
              <div className="flex-1" />
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={onClose}
              >
                Close
              </Button>
              {editable && (
                <Button type="submit" disabled={busy}>
                  {busy
                    ? "Saving…"
                    : draft
                      ? "Create and send invitation"
                      : "Save event"}
                </Button>
              )}
            </div>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
