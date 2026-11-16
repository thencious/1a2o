import { NextResponse } from "next/server";
import { withAuth } from "@/utils/middleware";
import { getCalendarCatalog } from "@/utils/calendar/month-service";

export const GET = withAuth("calendar/catalog", async (request) => {
  const data = await getCalendarCatalog(request.auth.userId, request.logger);
  return NextResponse.json(data, {
    headers: { "Cache-Control": "private, no-store" },
  });
});
