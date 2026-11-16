import { z } from "zod";
import type { MonthCalendar } from "./month-types";

export const calendarDefaults = z
  .object({
    defaultCalendarId: z.string().max(8192).nullable(),
    meetingProvider: z.enum(["google_meet", "zoom"]),
    zoomMeetingUrl: z
      .string()
      .max(2000)
      .refine((value) => {
        if (!value) return true;
        try {
          const url = new URL(value);
          return (
            url.protocol === "https:" &&
            !url.username &&
            !url.password &&
            ["zoom.us", "zoom.com"].some(
              (host) =>
                url.hostname === host || url.hostname.endsWith(`.${host}`),
            ) &&
            url.pathname !== "/"
          );
        } catch {
          return false;
        }
      }, "Enter a valid HTTPS Zoom meeting link."),
  })
  .refine(
    (value) =>
      value.meetingProvider !== "zoom" || Boolean(value.zoomMeetingUrl),
    {
      message: "Add your Zoom personal meeting link before selecting Zoom.",
      path: ["zoomMeetingUrl"],
    },
  );
export type CalendarDefaults = z.infer<typeof calendarDefaults>;
export const initialCalendarDefaults: CalendarDefaults = {
  defaultCalendarId: null,
  meetingProvider: "google_meet",
  zoomMeetingUrl: "",
};

export function preferredCalendar(
  calendars: MonthCalendar[],
  id: string | null,
) {
  return (
    calendars.find((calendar) => calendar.id === id && calendar.writable) ??
    calendars.find((calendar) => calendar.primary && calendar.writable) ??
    calendars.find((calendar) => calendar.writable)
  );
}
