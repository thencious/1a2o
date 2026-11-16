import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  state: {} as any,
  tasks: [] as any[],
  send: vi.fn(),
  checkpoint: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("./storage", () => ({
  getTodoState: async () => ({ tasks: mocks.tasks }),
}));
vi.mock("./integration-store", () => ({
  updateTodoIntegration: async (_user: string, change: any) =>
    change(mocks.state, mocks.checkpoint),
}));
vi.mock("@/utils/mcp/safe-fetch", () => ({ safePublicFetch: mocks.send }));
import { runTodoReminders } from "./reminders";
const now = Date.parse("2026-11-01T12:00:00Z");
beforeEach(() => {
  vi.clearAllMocks();
  mocks.state = {
    ntfyTopic: "https://ntfy.sh/example",
    ntfyToken: "private-token",
    timezone: "America/Los_Angeles",
    taskUrl: "http://localhost:3000/account/todo",
    reminders: {},
  };
  mocks.tasks = [
    {
      id: "one",
      title: "Sample deadline",
      notes: "",
      createdAt: 1,
      deadline: { at: now + 7_200_000 },
      estimatedSeconds: 3600,
    },
  ];
  mocks.send.mockResolvedValue(new Response("{}", { status: 200 }));
});
it("schedules once at the work-start threshold with server-only authorization and resumes without duplicate sends", async () => {
  const result = await runTodoReminders("owner", now);
  expect(result.queued).toBe(1);
  expect(mocks.send).toHaveBeenCalledTimes(1);
  expect(mocks.send.mock.calls[0][1]).toMatchObject({
    method: "POST",
    headers: {
      Authorization: "Bearer private-token",
      Delay: String((now + 3_600_000) / 1000),
    },
  });
  await runTodoReminders("owner", now + 1000);
  expect(mocks.send).toHaveBeenCalledTimes(1);
});
it("cancels on completion and replaces an edited deadline using the same sequence URL", async () => {
  await runTodoReminders("owner", now);
  mocks.tasks[0].deadline.at += 3_600_000;
  await runTodoReminders("owner", now + 1000);
  expect(mocks.send.mock.calls.map((call) => call[1].method)).toEqual([
    "POST",
    "DELETE",
    "POST",
  ]);
  expect(new Set(mocks.send.mock.calls.map((call) => call[0])).size).toBe(1);
  mocks.tasks[0].completedAt = now + 2000;
  await runTodoReminders("owner", now + 2000);
  expect(mocks.send.mock.calls.at(-1)![1].method).toBe("DELETE");
});
it("waits for the scheduling window and reports provider failures without claiming success", async () => {
  mocks.tasks[0].deadline.at = now + 100 * 3_600_000;
  expect((await runTodoReminders("owner", now)).waiting).toBe(1);
  expect(mocks.send).not.toHaveBeenCalled();
  mocks.tasks[0].deadline.at = now + 7_200_000;
  mocks.send.mockResolvedValue(new Response(null, { status: 403 }));
  const result = await runTodoReminders("owner", now);
  expect(result.queued).toBe(0);
  expect(result.errors[0]).toContain("403");
  expect(mocks.state.reminders).toEqual({});
});
