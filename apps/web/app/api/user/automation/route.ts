import { NextResponse } from "next/server";
import { withAuth } from "@/utils/middleware";
import { ruleDomain } from "@/utils/automation/local-rules";
import { getLocalRules } from "@/utils/automation/local-rules-service";

export const GET = withAuth("local-automation", async (request) => {
  const domain = ruleDomain.safeParse(
    request.nextUrl.searchParams.get("domain"),
  );
  if (!domain.success)
    return NextResponse.json(
      { error: "Choose Messages or Calendars." },
      { status: 400 },
    );
  return NextResponse.json(
    await getLocalRules(request.auth.userId, domain.data),
    { headers: { "Cache-Control": "private, no-store" } },
  );
});
