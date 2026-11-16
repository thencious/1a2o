import { z } from "zod";

export const calendarVisibility = z.object({
  visibleIds: z.array(z.string().max(2048)).max(5000).nullable(),
});
export type CalendarVisibility = z.infer<typeof calendarVisibility>;
export const changeCalendarVisibility = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("initialize"),
    ids: z.array(z.string().max(2048)).max(5000),
  }),
  z.object({
    operation: z.literal("replace"),
    ids: z.array(z.string().max(2048)).max(5000),
  }),
  z.object({
    operation: z.literal("toggle"),
    id: z.string().max(2048),
    visible: z.boolean(),
  }),
]);
export function applyCalendarVisibility(
  current: CalendarVisibility,
  change: z.infer<typeof changeCalendarVisibility>,
): CalendarVisibility {
  if (change.operation === "initialize" && current.visibleIds !== null)
    return current;
  if (change.operation !== "toggle")
    return { visibleIds: [...new Set(change.ids)] };
  const ids = new Set(current.visibleIds ?? []);
  if (change.visible) ids.add(change.id);
  else ids.delete(change.id);
  return { visibleIds: [...ids] };
}
