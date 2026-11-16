import { NextResponse } from "next/server";
import { withAuth } from "@/utils/middleware";
import { listMessages } from "@/utils/beeper/service";
import { z } from "zod";
import { combinedHistory } from "@/utils/messages/combined-history";
export const GET = withAuth("messages/thread", async (request) => {
  const input = z
    .object({
      chatId: z.string().min(1).max(2048),
      cursor: z.string().max(65_536).optional(),
      combined: z.enum(["1"]).optional(),
    })
    .safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!input.success)
    return NextResponse.json(
      { error: "Select a conversation" },
      { status: 400 },
    );
  return NextResponse.json(
    await (input.data.combined ? combinedHistory : listMessages)(
      request.auth.userId,
      input.data.chatId,
      input.data.cursor,
    ),
    { headers: { "Cache-Control": "private, no-store" } },
  );
});
