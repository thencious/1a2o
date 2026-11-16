"use server";

import { actionClientUser } from "./safe-action";
import {
  calendarEventTarget,
  saveMonthEventBody,
} from "./calendar-month.validation";
import {
  deleteMonthEvent,
  saveMonthEvent,
} from "@/utils/calendar/month-service";

export const saveMonthEventAction = actionClientUser
  .metadata({ name: "saveCalendarMonthEvent" })
  .inputSchema(saveMonthEventBody)
  .action(async ({ ctx: { userId, logger }, parsedInput }) =>
    saveMonthEvent(userId, parsedInput, logger),
  );

export const deleteMonthEventAction = actionClientUser
  .metadata({ name: "deleteCalendarMonthEvent" })
  .inputSchema(calendarEventTarget)
  .action(async ({ ctx: { userId, logger }, parsedInput }) =>
    deleteMonthEvent(userId, parsedInput, logger),
  );
