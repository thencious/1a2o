import { NextResponse } from "next/server";
import { withError } from "@/utils/middleware";
import { hasCronSecret } from "@/utils/cron";
import { syncDueLinkedInContacts } from "@/utils/linkedin/contacts";
import { syncDueEmailContacts } from "@/utils/contacts/email-store";

export const maxDuration = 300;
export const GET = withError("cron/linkedin-contacts", async (request) => {
  if (!hasCronSecret(request))
    return new Response("Unauthorized", { status: 401 });
  const [linkedIn, email] = await Promise.allSettled([
    syncDueLinkedInContacts(),
    syncDueEmailContacts(),
  ]);
  return NextResponse.json({
    failures:
      (linkedIn.status === "fulfilled" ? linkedIn.value.failures : 1) +
      (email.status === "fulfilled" ? email.value.failed : 1),
    linkedIn:
      linkedIn.status === "fulfilled" ? linkedIn.value : { failed: true },
    email: email.status === "fulfilled" ? email.value : { failed: true },
  });
});
