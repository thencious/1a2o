import { NextResponse } from "next/server";
import { withAuth } from "@/utils/middleware";
import { getCalendarVisibility } from "@/utils/calendar/visibility-store";

export const GET = withAuth("calendar/visibility", async (request) =>
  NextResponse.json(await getCalendarVisibility(request.auth.userId), {
    headers: { "Cache-Control": "private, no-store" },
  }),
);
