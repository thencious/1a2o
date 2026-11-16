import { NextResponse } from "next/server";
import { withError } from "@/utils/middleware";
import { hasCronSecret } from "@/utils/cron";
import { env } from "@/env";
import { ensureBeeperSession } from "@/utils/beeper/session-recovery";
export const maxDuration = 60;
export const GET = withError("cron/beeper-session", async (request) => {
  if (!hasCronSecret(request))
    return new Response("Unauthorized", { status: 401 });
  if (env.LOCAL_BEEPER_ENABLED !== "true" || !env.LOCAL_BEEPER_OWNER_ID)
    return NextResponse.json({ phase: "disabled" });
  return NextResponse.json(
    await ensureBeeperSession(env.LOCAL_BEEPER_OWNER_ID),
  );
});
