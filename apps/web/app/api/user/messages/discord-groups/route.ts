import { NextResponse } from "next/server";
import { withAuth } from "@/utils/middleware";
import { discordGroups } from "@/utils/beeper/service";
export const GET = withAuth("messages/private-groups", async (request) => {
  const cursor = request.nextUrl.searchParams.get("cursor") || undefined;
  if (cursor && cursor.length > 8192)
    return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
  return NextResponse.json(await discordGroups(request.auth.userId, cursor), {
    headers: { "Cache-Control": "private, no-store" },
  });
});
