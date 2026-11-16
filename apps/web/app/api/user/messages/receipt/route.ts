import { NextResponse } from "next/server";
import { withAuth } from "@/utils/middleware";
import { messageReceipt } from "@/utils/beeper/service";
import { z } from "zod";
export const GET = withAuth("messages/receipt", async (request) => {
  const input = z
    .object({
      chatId: z.string().min(1).max(2048),
      pendingId: z.string().min(1).max(2048),
    })
    .safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!input.success)
    return NextResponse.json(
      { error: "Invalid message receipt" },
      { status: 400 },
    );
  return NextResponse.json(
    await messageReceipt(
      request.auth.userId,
      input.data.chatId,
      input.data.pendingId,
    ),
    { headers: { "Cache-Control": "private, no-store" } },
  );
});
