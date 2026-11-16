import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { withAuth } from "@/utils/middleware";
import { getTodoState } from "@/utils/todo/storage";
import { getTodoPreferences } from "@/utils/todo/preferences";

export const GET = withAuth("todo-app", async (request) => {
  const workspace =
    request.nextUrl.searchParams.get("workspace") === "notes"
      ? "notes"
      : "tasks";
  const state = await getTodoState(request.auth.userId, workspace);
  const preferences = await getTodoPreferences(request.auth.userId);
  const bootstrap = JSON.stringify({
    ...state,
    workspace,
    aiAvailable: Boolean(process.env.OPENROUTER_API_KEY),
    windowsNotifications: process.platform === "win32",
    preferences,
  }).replace(/</g, "\\u003c");
  const html = (
    await readFile(
      resolve(
        process.cwd(),
        `public/open-todo-zero/${workspace === "notes" ? "notes" : "index"}.html`,
      ),
      "utf8",
    )
  ).replace(
    "<!--INBOX_TODO_BOOTSTRAP-->",
    `<script type="application/json" id="inbox-todo-bootstrap">${bootstrap}</script>`,
  );
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Frame-Options": "SAMEORIGIN",
    },
  });
});
