import { NextResponse } from "next/server";
import { withAuth } from "@/utils/middleware";
import { getTodoState } from "@/utils/todo/storage";
export const GET = withAuth("workspace/state", async (request) =>
  NextResponse.json(
    await getTodoState(
      request.auth.userId,
      request.nextUrl.searchParams.get("workspace") === "notes"
        ? "notes"
        : "tasks",
    ),
    { headers: { "Cache-Control": "private, no-store" } },
  ),
);
