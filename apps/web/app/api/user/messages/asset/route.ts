import { NextResponse } from "next/server";
import { withAuth } from "@/utils/middleware";
import { messageAsset } from "@/utils/beeper/service";
import { z } from "zod";
export const GET = withAuth("messages/asset", async (request) => {
  const input = z
    .object({
      chatId: z.string().min(1).max(2048),
      messageId: z.string().min(1).max(2048),
      index: z.coerce.number().int().min(0).max(100),
    })
    .safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!input.success)
    return NextResponse.json({ error: "Invalid attachment" }, { status: 400 });
  return messageAsset(
    request.auth.userId,
    input.data.chatId,
    input.data.messageId,
    input.data.index,
    request.headers.get("range"),
  );
});
