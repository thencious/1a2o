import { NextResponse } from "next/server";
import { withAuth } from "@/utils/middleware";
import { getTodoIntegration } from "@/utils/todo/integration-store";
export const GET = withAuth("todo-rules", async (request) => {
  const state = await getTodoIntegration(request.auth.userId);
  return NextResponse.json(
    { rules: state.taskRules, revision: state.rulesRevision },
    { headers: { "Cache-Control": "private, no-store" } },
  );
});
