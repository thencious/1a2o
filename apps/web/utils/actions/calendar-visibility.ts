"use server";
import { actionClientUser } from "./safe-action";
import { changeCalendarVisibility } from "@/utils/calendar/visibility";
import { setCalendarVisibility } from "@/utils/calendar/visibility-store";

export const saveCalendarVisibilityAction = actionClientUser
  .metadata({ name: "saveCalendarVisibility" })
  .inputSchema(changeCalendarVisibility)
  .action(async ({ ctx: { userId }, parsedInput }) =>
    setCalendarVisibility(userId, parsedInput),
  );
