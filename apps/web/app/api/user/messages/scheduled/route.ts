import { NextResponse } from "next/server";
import { withAuth } from "@/utils/middleware";
import { beeperChat } from "@/utils/actions/beeper.validation";
import { listScheduledMessages } from "@/utils/messages/scheduled";

export const GET = withAuth("messages/scheduled", async (request) => {
  const input = beeperChat.safeParse({
    chatId: request.nextUrl.searchParams.get("chatId"),
  });
  if (!input.success)
    return NextResponse.json(
      { error: "Select a conversation" },
      { status: 400 },
    );
  return NextResponse.json(
    await listScheduledMessages(request.auth.userId, input.data.chatId),
    { headers: { "Cache-Control": "private, no-store" } },
  );
});
