import { z } from "zod";

export const todoTask = z
  .object({
    id: z.string().min(1).max(250),
    title: z.string().max(250),
    notes: z.string().max(250_000),
    createdAt: z.number().finite(),
    completedAt: z.number().finite().nullable().optional(),
  })
  .passthrough();
export const todoTasks = z
  .array(todoTask)
  .max(5000)
  .superRefine((tasks, context) => {
    if (new Set(tasks.map((task) => task.id)).size !== tasks.length)
      context.addIssue({ code: "custom", message: "Task IDs must be unique." });
    if (JSON.stringify(tasks).length > 4_000_000)
      context.addIssue({
        code: "custom",
        message: "Checklist exceeds the 4 MB backup limit.",
      });
  });
export const saveTodo = z.object({
  revision: z.string().min(1),
  tasks: todoTasks,
});
export const analyzeTodo = z.object({
  request: z
    .record(z.string(), z.unknown())
    .refine(
      (value) => JSON.stringify(value).length <= 100_000,
      "Analysis request is too large.",
    ),
});

const calendarTarget = z.object({
  connectionId: z.string().min(1).max(256),
  calendarId: z.string().min(1).max(2048),
});
export const todoPreferences = z.object({
  defaultCalendar: calendarTarget.nullable().optional(),
  ntfyTopic: z
    .string()
    .max(2048)
    .refine((value) => {
      if (!value) return true;
      try {
        const url = new URL(value);
        return (
          url.protocol === "https:" &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash &&
          /^\/[\w-]+\/?$/.test(url.pathname)
        );
      } catch {
        return false;
      }
    }, "Use an HTTPS ntfy topic URL.")
    .optional(),
  ntfyToken: z.string().max(4096).optional(),
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
    }),
  taskUrl: z.string().url().max(2048).optional(),
});
export const todoCalendarTask = z.object({
  taskId: z.string().min(1).max(250),
});
export const todoCalendarChoice = todoCalendarTask.extend({
  hash: z.string().length(64),
  decision: z.enum(["update", "keep", "skip", "create"]),
  eventId: z.string().max(2048).optional(),
  calendarKey: z.string().max(4096).optional(),
  etag: z.string().max(1024).optional(),
});
