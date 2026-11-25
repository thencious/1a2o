import { after, NextResponse } from "next/server";
import { getUserErrorMessages } from "@/utils/error-messages";
import { withAuth } from "@/utils/middleware";
import { ACCOUNT_DISCONNECTED_ERROR_TYPE } from "@/utils/config";
import { readConnectionWarnings } from "@/utils/error-messages/connection-warnings";
import { checkExpiredConnections } from "@/utils/error-messages/check-expired-connections";
import { env } from "@/env";

export type GetErrorMessagesResponse = Awaited<ReturnType<typeof getWarnings>>;

export const GET = withAuth("user/error-messages", async (request) => {
  if (env.NEXT_PUBLIC_BYPASS_PREMIUM_CHECKS)
    after(() => checkExpiredConnections(request.auth.userId, request.logger));
  return NextResponse.json(await getWarnings(request.auth.userId), {
    headers: { "Cache-Control": "private, no-store" },
  });
});

async function getWarnings(userId: string) {
  const stored = await getUserErrorMessages(userId, {
    skipMailboxMigration: true,
  });
  const { [ACCOUNT_DISCONNECTED_ERROR_TYPE]: mailbox, ...other } = stored ?? {};
  const warnings = {
    ...other,
    ...(await readConnectionWarnings(userId, mailbox)),
  };
  return Object.keys(warnings).length ? warnings : null;
}
