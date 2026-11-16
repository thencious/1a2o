import "server-only";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getTodoIntegration } from "./integration-store";
import { taskPolicy } from "./task-rules";
import { assertTodoOwner } from "./storage";

export async function requestTodoAnalysis(
  userId: string,
  request: Record<string, unknown>,
  workspace: "tasks" | "notes" = "tasks",
) {
  assertTodoOwner(userId);
  if (!Array.isArray(request.messages) || !Array.isArray(request.tools))
    throw new Error("Invalid deadline analysis request.");
  const policy = taskPolicy((await getTodoIntegration(userId)).taskRules);
  const timePickingInstructions = (
    await readFile(
      resolve(process.cwd(), "public/open-todo-zero/TIME-PICKING.md"),
      "utf8",
    )
  ).replaceAll(
    "{{LATE_NIGHT_CUTOFF}}",
    `${String(policy.lateNightHour).padStart(2, "0")}:00`,
  );
  const messages = request.messages.map((message) => {
    if (
      message &&
      typeof message === "object" &&
      "role" in message &&
      message.role === "system" &&
      "content" in message
    )
      return {
        ...message,
        content:
          String(message.content) +
          "\n\nTask time-picking instructions:\n" +
          timePickingInstructions +
          "\n\nConfigured task rules (earlier rules take precedence):\n" +
          policy.aiInstructions,
      };
    return message;
  });
  const response = await fetch(
    "http://127.0.0.1:3010/api/v1/chat/completions",
    {
      method: "POST",
      signal: AbortSignal.timeout(240_000),
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "x-inbox-zero-feature":
          workspace === "notes"
            ? "Note to task summary and deadline"
            : "Todo deadline and work estimate",
        "x-inbox-zero-items": "1",
      },
      body: JSON.stringify({
        ...request,
        messages,
        model: undefined,
        stream: false,
        models: [
          "nvidia/nemotron-3.5-super-vl:free",
          "nvidia/nemotron-3-ultra-550b-a55b:free",
        ],
        provider: {
          require_parameters: true,
          allow_fallbacks: true,
          max_price: { prompt: 0, completion: 0 },
        },
        reasoning:
          workspace === "tasks"
            ? { enabled: false, effort: "none" }
            : request.reasoning,
        max_tokens: workspace === "tasks" ? 2048 : 8192,
      }),
    },
  );
  const body = await response.json().catch(() => ({
    error: { message: "OpenRouter returned an invalid response." },
  }));
  return { status: response.status, body };
}
