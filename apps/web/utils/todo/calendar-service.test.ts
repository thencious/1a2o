import { beforeEach, expect, it, vi } from "vitest";
import { createTestLogger } from "@/__tests__/helpers";
const mocks = vi.hoisted(() => ({
  state: {} as any,
  tasks: [] as any[],
  month: vi.fn(),
  save: vi.fn(),
  target: vi.fn(),
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
vi.mock("@/utils/calendar/month-service", () => ({
  getCalendarMonth: mocks.month,
  getMonthWriteTarget: mocks.target,
  saveMonthEvent: mocks.save,
}));
import { syncTodoCalendar } from "./calendar-service";
const logger = createTestLogger();
const calendar = {
  id: "calendar",
  connectionId: "connection",
  calendarId: "primary",
  writable: true,
  name: "Work",
  accountEmail: "owner@example.com",
  provider: "google",
  primary: true,
};
const task = {
  id: "task",
  title: "Interview at 2pm",
  notes: "Task notes",
  createdAt: 1,
  aiState: "success",
  aiEvidence: {
    arguments: {
      calendar_kind: "event",
      calendar_explicit_time: true,
      calendar_title: "Interview",
      calendar_start_local: "2026-11-02T14:00:00",
      calendar_end_local: "2026-11-02T15:00:00",
    },
    timeContext: { sender_timezone: "America/Los_Angeles" },
  },
};
const event = {
  id: "event",
  calendarKey: "calendar",
  title: "Interview",
  description: "Existing notes",
  location: "Room 1",
  start: "2026-11-02T22:00:00Z",
  end: "2026-11-02T23:00:00Z",
  guests: ["guest@example.com"],
  etag: "version-1",
  editable: true,
  allDay: false,
  recurring: false,
  descriptionLocked: false,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.state = {
    defaultCalendar: { connectionId: "connection", calendarId: "primary" },
    links: {},
    requests: {},
    dismissed: {},
    pending: {},
  };
  mocks.tasks = [structuredClone(task)];
  mocks.month.mockResolvedValue({
    calendars: [calendar],
    events: [],
    warnings: [],
  });
  mocks.target.mockResolvedValue({ calendar });
  mocks.save.mockResolvedValue({ id: "created" });
});
it("creates automatically only after the duplicate scan and never creates twice for the same analysis", async () => {
  expect((await syncTodoCalendar("owner", "task", logger)).kind).toBe(
    "created",
  );
  expect(mocks.month).toHaveBeenCalledTimes(1);
  expect(mocks.checkpoint).toHaveBeenCalled();
  expect(mocks.save).toHaveBeenCalledTimes(1);
  expect((await syncTodoCalendar("owner", "task", logger)).kind).toBe(
    "unchanged",
  );
  expect(mocks.save).toHaveBeenCalledTimes(1);
});
it("prompts for an externally-created duplicate and updates it only on confirmation, preserving guests and notes", async () => {
  mocks.month.mockResolvedValue({
    calendars: [calendar],
    events: [event],
    warnings: [],
  });
  const result = await syncTodoCalendar("owner", "task", logger);
  expect(result.kind).toBe("duplicate");
  expect(mocks.save).not.toHaveBeenCalled();
  if (result.kind !== "duplicate") throw new Error("Expected dialog");
  await syncTodoCalendar("owner", "task", logger, {
    hash: result.prompt.proposal.hash,
    decision: "update",
    eventId: "event",
    calendarKey: "calendar",
    etag: "version-1",
  });
  expect(mocks.save.mock.calls[0][1]).toMatchObject({
    eventId: "event",
    etag: "version-1",
    description: "Existing notes",
    location: "Room 1",
    guests: ["guest@example.com"],
  });
});
it("checks other saved tasks even if no corresponding calendar event exists", async () => {
  mocks.tasks.push({ ...structuredClone(task), id: "other" });
  const result = await syncTodoCalendar("owner", "task", logger);
  expect(result.kind).toBe("duplicate");
  expect(mocks.save).not.toHaveBeenCalled();
});
it("refuses incomplete scans, changed events and read-only updates", async () => {
  mocks.month.mockResolvedValueOnce({
    calendars: [calendar],
    events: [],
    warnings: ["Calendar offline"],
  });
  await expect(syncTodoCalendar("owner", "task", logger)).rejects.toThrow(
    "every connected calendar",
  );
  expect(mocks.save).not.toHaveBeenCalled();
  mocks.month.mockResolvedValue({
    calendars: [calendar],
    events: [event],
    warnings: [],
  });
  const result = await syncTodoCalendar("owner", "task", logger);
  if (result.kind !== "duplicate") throw new Error("Expected dialog");
  mocks.month.mockResolvedValue({
    calendars: [calendar],
    events: [{ ...event, etag: "version-2" }],
    warnings: [],
  });
  await expect(
    syncTodoCalendar("owner", "task", logger, {
      hash: result.prompt.proposal.hash,
      decision: "update",
      eventId: "event",
      calendarKey: "calendar",
      etag: "version-1",
    }),
  ).rejects.toThrow("changed");
  mocks.month.mockResolvedValue({
    calendars: [calendar],
    events: [{ ...event, editable: false }],
    warnings: [],
  });
  await expect(
    syncTodoCalendar("owner", "task", logger, {
      hash: result.prompt.proposal.hash,
      decision: "update",
      eventId: "event",
      calendarKey: "calendar",
      etag: "version-1",
    }),
  ).rejects.toThrow("read-only");
  expect(mocks.save).not.toHaveBeenCalled();
});
it("reuses its persisted request ID after an ambiguous provider failure", async () => {
  mocks.save.mockRejectedValueOnce(new Error("Connection lost"));
  await expect(syncTodoCalendar("owner", "task", logger)).rejects.toThrow(
    "Connection lost",
  );
  const requestId = mocks.save.mock.calls[0][1].requestId;
  await syncTodoCalendar("owner", "task", logger);
  expect(mocks.save.mock.calls[1][1].requestId).toBe(requestId);
});
it("creates date-only tasks as all-day events with an exclusive end date", async () => {
  mocks.tasks[0].aiEvidence.arguments = {
    ...mocks.tasks[0].aiEvidence.arguments,
    calendar_explicit_time: false,
    calendar_start_local: "2026-11-02T00:00:00",
    calendar_end_local: "2026-11-03T00:00:00",
  };
  await syncTodoCalendar("owner", "task", logger);
  expect(mocks.save.mock.calls[0][1]).toMatchObject({
    allDay: true,
    start: "2026-11-02",
    end: "2026-11-03",
  });
  expect(mocks.month.mock.calls[0].slice(1, 3)).toEqual([
    "2026-11-02T08:00:00.000Z",
    "2026-11-03T08:00:00.000Z",
  ]);
});

it("asks for a calendar on first use without writing an event", async () => {
  mocks.state.defaultCalendar = null;
  expect(await syncTodoCalendar("owner", "task", logger)).toMatchObject({
    kind: "needs-calendar",
    taskId: "task",
  });
  expect(mocks.save).not.toHaveBeenCalled();
  expect(mocks.month).not.toHaveBeenCalled();
});
it("remembers a calendar per task while asking separately for each new task", async () => {
  mocks.state.calendarMode = "ask";
  expect((await syncTodoCalendar("owner", "task", logger)).kind).toBe(
    "needs-calendar",
  );
  const target = { connectionId: "other", calendarId: "chosen" };
  expect(
    (await syncTodoCalendar("owner", "task", logger, undefined, target)).kind,
  ).toBe("created");
  expect(mocks.save.mock.calls[0][1]).toMatchObject(target);
  expect((await syncTodoCalendar("owner", "task", logger)).kind).toBe(
    "unchanged",
  );
  mocks.tasks.push({ ...structuredClone(task), id: "new-task" });
  expect((await syncTodoCalendar("owner", "new-task", logger)).kind).toBe(
    "needs-calendar",
  );
  expect(mocks.state.defaultCalendar.calendarId).toBe("primary");
});
it("checks duplicates before adding to a manually chosen calendar and retains the choice through review", async () => {
  mocks.state.calendarMode = "ask";
  mocks.month.mockResolvedValue({
    calendars: [calendar],
    events: [event],
    warnings: [],
  });
  const target = { connectionId: "chosen", calendarId: "selected" };
  const result = await syncTodoCalendar(
    "owner",
    "task",
    logger,
    undefined,
    target,
  );
  expect(result.kind).toBe("duplicate");
  expect(mocks.save).not.toHaveBeenCalled();
  if (result.kind !== "duplicate") throw new Error("Expected review");
  await syncTodoCalendar("owner", "task", logger, {
    hash: result.prompt.proposal.hash,
    decision: "create",
  });
  expect(mocks.save.mock.calls[0][1]).toMatchObject(target);
});
it("distinguishes disabled calendar creation from missing calendar setup", async () => {
  mocks.state.calendarMode = "off";
  expect(await syncTodoCalendar("owner", "task", logger)).toMatchObject({
    kind: "disabled",
    reason: "off",
  });
  expect(mocks.save).not.toHaveBeenCalled();
});
it("rejects an unwritable calendar before persisting a per-task choice", async () => {
  mocks.target.mockRejectedValue(new Error("Read only"));
  await expect(
    syncTodoCalendar("owner", "task", logger, undefined, {
      connectionId: "x",
      calendarId: "y",
    }),
  ).rejects.toThrow("Read only");
  expect(mocks.state.taskCalendars).toBeUndefined();
  expect(mocks.save).not.toHaveBeenCalled();
});
