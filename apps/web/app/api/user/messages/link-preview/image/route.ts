import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/utils/middleware";
import { messagePreviewImage } from "@/utils/beeper/service";

export const GET = withAuth("messages/link-preview/image", async (request) => {
  const input = z
    .object({
      chatId: z.string().min(1).max(2048),
      messageId: z.string().min(1).max(2048),
      index: z.coerce.number().int().min(0).max(2),
    })
    .safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!input.success)
    return NextResponse.json(
      { error: "Invalid preview image" },
      { status: 400 },
    );
  return messagePreviewImage(
    request.auth.userId,
    input.data.chatId,
    input.data.messageId,
    input.data.index,
  );
});
