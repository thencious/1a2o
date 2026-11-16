import { NextResponse } from "next/server";
import { z } from "zod";
import { withError } from "@/utils/middleware";
import { hasCronSecret } from "@/utils/cron";
import { collectAttention } from "@/utils/attention/collect";
import { attentionOwner, updateAttention } from "@/utils/attention/store";
import {
  suppressViewedMessages,
  attentionCounts,
} from "@/utils/attention/policy";

export const maxDuration = 300;
export const GET = withError("cron/desktop-notifications", async (request) => {
  if (!hasCronSecret(request))
    return new Response("Unauthorized", { status: 401 });
  const owner = attentionOwner();
  if (!owner)
    return NextResponse.json({ enabled: false, counts: {}, events: [] });
  return NextResponse.json(await collectAttention(owner, request.logger), {
    headers: { "Cache-Control": "private, no-store" },
  });
});
export const POST = withError(
  "cron/desktop-notifications/ack",
  async (request) => {
    if (!hasCronSecret(request))
      return new Response("Unauthorized", { status: 401 });
    const owner = attentionOwner();
    if (!owner) return new Response("Disabled", { status: 403 });
    const parsed = z
      .object({
        ids: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(50),
        prepare: z.literal(true).optional(),
      })
      .safeParse(await request.json());
    if (!parsed.success)
      return new Response("Invalid notification receipts", { status: 400 });
    const result = await updateAttention(owner, (state) => {
      if (parsed.data.prepare) {
        suppressViewedMessages(state);
        return {
          events: parsed.data.ids.flatMap((id) => {
            const event = state.events[id];
            return event && !event.readAt && !event.deliveredAt ? [event] : [];
          }),
          counts: attentionCounts(state),
        };
      }
      for (const id of parsed.data.ids)
        if (state.events[id]) state.events[id].deliveredAt = Date.now();
      return { saved: true };
    });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  },
);
