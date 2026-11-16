import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/utils/middleware";
import { SafeError } from "@/utils/error";
import { saveTodoState } from "@/utils/todo/storage";
import { todoTasks } from "@/utils/actions/todo.validation";
export const PUT = withAuth("todo/offline", async (request) => {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    throw new SafeError("Open the workspace in your 1a2o app.", 403);
  const body = z
    .object({
      workspace: z.enum(["tasks", "notes"]),
      revision: z.string().min(1).max(128),
      tasks: todoTasks,
    })
    .parse(await request.json());
  return NextResponse.json(
    await saveTodoState(
      request.auth.userId,
      body.revision,
      body.tasks,
      body.workspace,
    ),
    { headers: { "Cache-Control": "no-store" } },
  );
});
