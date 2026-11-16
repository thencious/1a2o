import { NextResponse } from "next/server";
import { withAuth } from "@/utils/middleware";
import { calendarMonthRange } from "@/utils/actions/calendar-month.validation";
import { getCalendarMonth } from "@/utils/calendar/month-service";
import { labelRuleItems } from "@/utils/automation/local-rules-service";

export const maxDuration = 180;
export const GET = withAuth("calendar/month", async (request) => {
  const range = calendarMonthRange.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!range.success)
    return NextResponse.json(
      { error: "Choose a valid month range." },
      { status: 400 },
    );
  const data = await getCalendarMonth(
    request.auth.userId,
    range.data.start,
    range.data.end,
    request.logger,
  );
  const labels = await labelRuleItems(
    request.auth.userId,
    "calendars",
    data.events.map((event) => ({
      id: `${event.calendarKey}:${event.id}`,
      title: event.title,
      account: data.calendars.find(
        (calendar) => calendar.id === event.calendarKey,
      )?.accountEmail,
      network: data.calendars.find(
        (calendar) => calendar.id === event.calendarKey,
      )?.provider,
      text: `${event.description}\n${event.location}\n${event.guests.join(", ")}\n${event.start} — ${event.end}`,
      version: event.etag,
    })),
  );
  const tagged = {
    ...data,
    events: data.events.map((event) => ({
      ...event,
      ruleLabel: labels[`${event.calendarKey}:${event.id}`] ?? null,
    })),
  };
  return NextResponse.json(tagged, {
    headers: { "Cache-Control": "private, no-store" },
  });
});
