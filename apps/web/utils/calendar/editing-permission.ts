import { SafeError } from "@/utils/error";

export class CalendarEditingPermissionError extends SafeError {
  constructor() {
    super(
      "Calendar editing permission was not granted. Reconnect and allow calendar event editing.",
    );
  }
}

export function requireCalendarEditingScope(
  provider: "google" | "microsoft",
  grantedScope?: string | null,
) {
  const scopes = (grantedScope ?? "").toLowerCase().split(/\s+/);
  const granted =
    provider === "google"
      ? scopes.some(
          (scope) =>
            scope === "https://www.googleapis.com/auth/calendar" ||
            scope === "https://www.googleapis.com/auth/calendar.events",
        )
      : scopes.some((scope) =>
          /(?:^|\/)calendars\.readwrite(?:\.shared)?$/.test(scope),
        );
  if (!granted) throw new CalendarEditingPermissionError();
}
