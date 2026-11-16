import { NextResponse } from "next/server";
import { withAuth } from "@/utils/middleware";
import { getCalendarDefaults } from "@/utils/calendar/defaults-store";

export const GET = withAuth("calendar/defaults", async (request) =>
  NextResponse.json(await getCalendarDefaults(request.auth.userId), {
    headers: { "Cache-Control": "private, no-store" },
  }),
);
