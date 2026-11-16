import "server-only";
import { taskPolicy } from "./task-rules";
import { taskReminderTime } from "./reminder-time";
import { createHash } from "node:crypto";
import { safePublicFetch } from "@/utils/mcp/safe-fetch";
import { getTodoState } from "./storage";
import { updateTodoIntegration } from "./integration-store";

export async function runTodoReminders(userId: string, now = Date.now()) {
  return updateTodoIntegration(userId, async (state, checkpoint) => {
    const { tasks } = await getTodoState(userId);
    const policy = taskPolicy(state.taskRules);
    let queued = 0,
      waiting = 0;
    const errors: string[] = [];
    const atFor = (task: (typeof tasks)[number]) =>
      taskReminderTime(task, policy);
    async function send(
      topic: string,
      id: string,
      method: "POST" | "DELETE",
      at?: number,
      body?: string,
      savedToken?: string,
    ) {
      const headers: Record<string, string> = {};
      const token =
        savedToken ?? (topic === state.ntfyTopic ? state.ntfyToken : "");
      if (token) headers.Authorization = `Bearer ${token}`;
      if (method === "POST") {
        headers["Content-Type"] = "text/plain; charset=utf-8";
        headers.Title = "Time to start your task";
        headers.Priority = "4";
        headers.Click =
          state.taskUrl ||
          process.env.NEXT_PUBLIC_BASE_URL ||
          "http://localhost:3000";
        if (at! > now + 10_000) headers.Delay = String(Math.ceil(at! / 1000));
      }
      const response = await safePublicFetch(
        `${topic}/still-${encodeURIComponent(id)}`,
        { method, headers, body, signal: AbortSignal.timeout(12_000) },
      );
      if (!response.ok && !(method === "DELETE" && response.status === 404)) {
        await response.body?.cancel();
        throw new Error(
          `ntfy returned HTTP ${response.status}. Check the topic and access token.`,
        );
      }
      await response.body?.cancel();
    }
    for (const [id, job] of Object.entries(state.reminders)) {
      const task = tasks.find((item) => item.id === id),
        time = task && atFor(task);
      const signature =
        task && time
          ? createHash("sha256")
              .update(
                JSON.stringify([
                  task.title,
                  time.at,
                  time.due,
                  task.estimatedSeconds,
                  state.ntfyTopic,
                ]),
              )
              .digest("hex")
          : null;
      if (
        job.state === "queued" &&
        (job.signature !== signature || job.topic !== state.ntfyTopic)
      ) {
        try {
          if (job.at > now)
            await send(
              job.topic,
              id,
              "DELETE",
              undefined,
              undefined,
              job.token,
            );
          delete state.reminders[id];
          await checkpoint();
        } catch (error) {
          errors.push(
            error instanceof Error
              ? error.message
              : "Could not cancel a task reminder.",
          );
        }
      } else if (job.state === "queued" && job.at <= now)
        job.state = "delivered";
    }
    if (state.ntfyTopic)
      for (const task of tasks) {
        const time = atFor(task);
        if (!time || time.due <= now) continue;
        const signature = createHash("sha256")
          .update(
            JSON.stringify([
              task.title,
              time.at,
              time.due,
              task.estimatedSeconds,
              state.ntfyTopic,
            ]),
          )
          .digest("hex");
        const existing = state.reminders[task.id];
        if (existing?.signature === signature) {
          queued++;
          continue;
        }
        if (existing?.state === "queued") {
          waiting++;
          continue;
        }
        if (time.at - now > 70 * 3_600_000) {
          waiting++;
          continue;
        }
        try {
          await send(
            state.ntfyTopic,
            task.id,
            "POST",
            time.at,
            `${task.title}\nEstimated work: ${Math.ceil(Number(task.estimatedSeconds) / 60)} min. Due ${new Date(time.due).toLocaleString("en-US", { timeZone: state.timezone })} (${state.timezone}).`,
          );
          state.reminders[task.id] = {
            topic: state.ntfyTopic,
            token: state.ntfyToken,
            at: time.at,
            signature,
            state: time.at > now ? "queued" : "delivered",
          };
          await checkpoint();
          queued++;
        } catch (error) {
          errors.push(
            error instanceof Error
              ? error.message
              : "Could not schedule a task reminder.",
          );
        }
      }
    state.ntfyStatus = { checkedAt: now, queued, waiting, errors };
    return { ...state.ntfyStatus, configured: Boolean(state.ntfyTopic) };
  });
}
