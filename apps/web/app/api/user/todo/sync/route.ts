import { NextResponse } from "next/server";
import { withAuth } from "@/utils/middleware";
import { getCloudSyncStatus } from "@/utils/todo/cloud-sync";
export const GET = withAuth("todo/sync", async (request) =>
  NextResponse.json(await getCloudSyncStatus(request.auth.userId), {
    headers: { "Cache-Control": "private, no-store" },
  }),
);
