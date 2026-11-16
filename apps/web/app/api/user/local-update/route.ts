import { NextResponse } from "next/server";
import { withAuth } from "@/utils/middleware";
import { readLocalUpdate } from "@/utils/local-update/status";

export const GET = withAuth("local-update/status", async (request) =>
  NextResponse.json(await readLocalUpdate(request.auth.userId), {
    headers: { "Cache-Control": "private, no-store" },
  }),
);
export type LocalUpdateStatus = Awaited<ReturnType<typeof readLocalUpdate>>;
