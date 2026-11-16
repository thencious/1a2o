import { NextResponse } from "next/server";
import { withAuth } from "@/utils/middleware";
import { getOpenRouterUsage } from "@/utils/openrouter-usage";

export const GET = withAuth("openrouter-usage", async (request) => {
  const day =
    request.nextUrl.searchParams.get("date") ||
    new Date().toISOString().slice(0, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !Number.isFinite(Date.parse(`${day}T00:00:00Z`)) ||
    new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day
  )
    return NextResponse.json(
      { error: "Choose a valid UTC date." },
      { status: 400 },
    );
  return NextResponse.json(await getOpenRouterUsage(request.auth.userId, day), {
    headers: { "Cache-Control": "private, no-store" },
  });
});
