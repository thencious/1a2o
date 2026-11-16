import { NextResponse } from "next/server";
import { withAuth } from "@/utils/middleware";
import {
  beeperRecoveryPreferencesForUser,
  ensureBeeperSession,
} from "@/utils/beeper/session-recovery";
export const GET = withAuth("messages/recovery", async (request) =>
  NextResponse.json(
    {
      ...(await beeperRecoveryPreferencesForUser(request.auth.userId)),
      status: await ensureBeeperSession(request.auth.userId),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  ),
);
