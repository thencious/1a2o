import { NextResponse } from "next/server";
import { withAuth } from "@/utils/middleware";
import { listConversations, listMessages } from "@/utils/beeper/service";
import { labelRuleItems } from "@/utils/automation/local-rules-service";
export const GET = withAuth("messages/conversations", async (request) => {
  const cursor = request.nextUrl.searchParams.get("cursor") || undefined;
  if (cursor && cursor.length > 8192)
    return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
  const data = await listConversations(request.auth.userId, cursor);
  const labels = await labelRuleItems(
    request.auth.userId,
    "messages",
    data.items.map((item) => ({
      id: item.id,
      title: item.title,
      text: item.preview,
      account: item.account,
      network: item.network,
      version: item.time,
    })),
    async (item) => {
      const thread = await listMessages(request.auth.userId, item.id);
      return thread.items
        .sort((a, b) => Date.parse(a.time) - Date.parse(b.time))
        .slice(-8)
        .map(
          (message) =>
            `${message.outgoing ? "You" : message.sender}: ${message.text.slice(0, 1000)}`,
        )
        .join("\n");
    },
  );
  return NextResponse.json(
    {
      ...data,
      items: data.items.map((item) => ({
        ...item,
        ruleLabel: labels[item.id] ?? null,
      })),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
});
