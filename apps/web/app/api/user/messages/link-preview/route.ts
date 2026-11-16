import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/utils/middleware";
import { messageLinkPreviews } from "@/utils/beeper/service";

export const GET = withAuth("messages/link-preview", async (request) => {
  const input = z
    .object({
      chatId: z.string().min(1).max(2048),
      messageId: z.string().min(1).max(2048),
    })
    .safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!input.success)
    return NextResponse.json({ error: "Invalid message" }, { status: 400 });
  const previews = await messageLinkPreviews(
    request.auth.userId,
    input.data.chatId,
    input.data.messageId,
  );
  return NextResponse.json(
    { previews },
    { headers: { "Cache-Control": "private, no-store" } },
  );
});
