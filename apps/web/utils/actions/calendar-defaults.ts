"use server";
import { actionClientUser } from "./safe-action";
import { calendarDefaults } from "@/utils/calendar/defaults";
import { setCalendarDefaults } from "@/utils/calendar/defaults-store";

export const saveCalendarDefaultsAction = actionClientUser
  .metadata({ name: "saveCalendarDefaults" })
  .inputSchema(calendarDefaults)
  .action(async ({ ctx: { userId }, parsedInput }) =>
    setCalendarDefaults(userId, parsedInput),
  );
