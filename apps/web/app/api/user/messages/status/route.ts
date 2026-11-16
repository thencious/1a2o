import { NextResponse } from "next/server";
import { withAuth } from "@/utils/middleware";
import { beeperStatus } from "@/utils/beeper/service";
export const GET = withAuth("messages/status", async (request) =>
  NextResponse.json(await beeperStatus(request.auth.userId), {
    headers: { "Cache-Control": "private, no-store" },
  }),
);
