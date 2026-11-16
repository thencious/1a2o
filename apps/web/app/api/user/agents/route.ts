import { NextResponse } from "next/server";
import { withAuth } from "@/utils/middleware";
import { localAgentsRequest } from "@/utils/agents/service";
export const GET = withAuth("agents/state", async (request) =>
  NextResponse.json(await localAgentsRequest(request.auth.userId, "/state"), {
    headers: { "Cache-Control": "private, no-store" },
  }),
);
