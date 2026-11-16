import { NextResponse } from "next/server";
import { withAuth } from "@/utils/middleware";
import { chatGPTStatus } from "@/utils/chatgpt/service";
export const GET = withAuth("chatgpt/status", async (request) =>
  NextResponse.json(await chatGPTStatus(request.auth.userId), {
    headers: { "Cache-Control": "private, no-store" },
  }),
);
export type ChatGPTStatus = Awaited<ReturnType<typeof chatGPTStatus>>;
