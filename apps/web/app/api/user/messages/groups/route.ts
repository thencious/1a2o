import { NextResponse } from "next/server";
import { withAuth } from "@/utils/middleware";
import { conversationGroups } from "@/utils/messages/conversation-group-store";
export const GET = withAuth("messages/groups", async (request) =>
  NextResponse.json(await conversationGroups(request.auth.userId), {
    headers: { "Cache-Control": "private, no-store" },
  }),
);
