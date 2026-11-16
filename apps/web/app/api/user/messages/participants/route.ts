import { NextResponse } from "next/server";
import { withAuth } from "@/utils/middleware";
import { beeperChat } from "@/utils/actions/beeper.validation";
import { mentionParticipants } from "@/utils/beeper/service";
export const GET = withAuth("messages/participants", async (request) => {
  const input = beeperChat.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!input.success)
    return NextResponse.json(
      { error: "Select a conversation." },
      { status: 400 },
    );
  return NextResponse.json(
    await mentionParticipants(request.auth.userId, input.data.chatId),
    { headers: { "Cache-Control": "private, no-store" } },
  );
});
