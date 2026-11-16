import { NextResponse } from "next/server";
import { withAuth } from "@/utils/middleware";
import { attentionOwner, readAttention } from "@/utils/attention/store";
import { attentionCounts } from "@/utils/attention/policy";
import { readDesktopActivation } from "@/utils/attention/desktop-activation.mjs";
import { localWorkspaceRoot } from "@/utils/local-workspace";

export const GET = withAuth("attention", async (request) => {
  if (request.auth.userId !== attentionOwner())
    return NextResponse.json({ enabled: false, counts: {}, through: 0 });
  const state = await readAttention(request.auth.userId);
  return NextResponse.json(
    {
      enabled: true,
      counts: attentionCounts(state),
      through: Date.now(),
      activation: readDesktopActivation(localWorkspaceRoot()),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
});
