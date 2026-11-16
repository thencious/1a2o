import { NextResponse } from "next/server";
import { withError } from "@/utils/middleware";
import { hasCronSecret } from "@/utils/cron";
import { runTodoReminders } from "@/utils/todo/reminders";
export const maxDuration = 300;
export const GET = withError("cron/todo-reminders", async (request) => {
  if (!hasCronSecret(request))
    return new Response("Unauthorized", { status: 401 });
  const owner =
    process.env.LOCAL_BEEPER_OWNER_ID || process.env.LOCAL_AGENTS_OWNER_ID;
  if (!owner) return NextResponse.json({ configured: false });
  return NextResponse.json(await runTodoReminders(owner));
});
