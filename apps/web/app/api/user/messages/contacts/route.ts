import { NextResponse } from "next/server";
import { withAuth } from "@/utils/middleware";
import { contactDirectory } from "@/utils/contacts/directory";
import type { syncBeeperContacts } from "@/utils/beeper/contacts";

export const maxDuration = 300;
export const GET = withAuth("messages/contacts", async (request) => {
  const data = await contactDirectory(request.auth.userId, true);
  return NextResponse.json(data, {
    headers: { "Cache-Control": "private, no-store" },
  });
});
export type GetContactsResponse = Awaited<
  ReturnType<typeof syncBeeperContacts>
>;
