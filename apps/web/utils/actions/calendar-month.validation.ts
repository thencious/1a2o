import { z } from "zod";

const target = {
  connectionId: z.string().min(1).max(256),
  calendarId: z.string().min(1).max(2048),
};
export const calendarEventTarget = z.object({
  ...target,
  eventId: z.string().min(1).max(2048),
  etag: z.string().min(1).max(1024),
});
export const calendarMonthRange = z
  .object({
    start: z.iso.datetime(),
    end: z.iso.datetime(),
  })
  .refine(
    ({ start, end }) =>
      Date.parse(end) > Date.parse(start) &&
      Date.parse(end) - Date.parse(start) <= 45 * 86_400_000,
    "Choose a range of up to 45 days.",
  );

export const saveMonthEventBody = z
  .object({
    ...target,
    eventId: z.string().min(1).max(2048).optional(),
    etag: z.string().max(1024).optional(),
    requestId: z.uuid(),
    title: z.string().trim().min(1).max(512),
    description: z.string().max(20_000),
    location: z.string().max(2000),
    start: z.string(),
    end: z.string(),
    allDay: z.boolean(),
    timezone: z
      .string()
      .max(120)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, "Choose a valid timezone.")
      .optional(),
    guests: z.array(z.email()).max(100),
    conference: z.enum(["none", "google_meet", "zoom"]).optional(),
  })
  .superRefine((value, ctx) => {
    const date = z.iso.date();
    const instant = z.iso.datetime();
    const schema = value.allDay ? date : instant;
    if (
      !schema.safeParse(value.start).success ||
      !schema.safeParse(value.end).success ||
      !(Date.parse(value.end) > Date.parse(value.start))
    )
      ctx.addIssue({
        code: "custom",
        message: "End must be after start, with valid dates and times.",
      });
    if (value.eventId && !value.etag)
      ctx.addIssue({
        code: "custom",
        message: "Reload this event before editing.",
      });
  });
export type SaveMonthEvent = z.infer<typeof saveMonthEventBody>;
