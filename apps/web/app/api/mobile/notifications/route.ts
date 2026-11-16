import { NextResponse } from "next/server";
import { withAuth } from "@/utils/middleware";
import { attentionOwner, readAttention } from "@/utils/attention/store";
export const GET = withAuth("mobile/notifications", async (request) => {
  const now = Date.now();
  const value = Number(request.nextUrl.searchParams.get("since"));
  const since =
    Number.isFinite(value) && value > 0
      ? Math.max(value, now - 7 * 86_400_000)
      : now;
  if (request.auth.userId !== attentionOwner())
    return NextResponse.json(
      { notifications: [], through: now },
      { headers: { "Cache-Control": "no-store" } },
    );
  const state = await readAttention(request.auth.userId);
  const notifications = Object.values(state.events)
    .filter(
      (event) =>
        event.tab !== "agents" &&
        !event.readAt &&
        event.at > since &&
        event.at <= now,
    )
    .sort((a, b) => a.at - b.at)
    .slice(0, 100);
  return NextResponse.json(
    {
      notifications: notifications.map(
        ({ id, tab, title, body, path, at }) => ({
          id,
          tab,
          title,
          body,
          path,
          at,
        }),
      ),
      through: notifications.length === 100 ? notifications[99].at : now,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
