import { describe, expect, it } from "vitest";
import {
  attentionCounts,
  clearAttentionTab,
  enqueueAttention,
  eventId,
  observeAgent,
  reportMessageView,
  suppressViewedMessages,
} from "./policy";
import type { AttentionState } from "./types";

function state(): AttentionState {
  return { startedAt: 1, checkpoints: {}, events: {}, agents: {} };
}
describe("attention events", () => {
  it("silences only the focused conversation and never replays seen messages after leaving", () => {
    const value = state();
    for (const [id, tab, path] of [
      ["viewed", "messages", "/a/messages?chatId=chat%3Aone"],
      ["other", "messages", "/a/messages?chatId=chat%3Atwo"],
      ["mail", "mail", "/a/mail"],
      ["agent", "agents", "/a/agents"],
    ] as const)
      enqueueAttention(value, {
        id,
        tab,
        path,
        at: 10,
        title: "Title",
        body: "Body",
      });
    reportMessageView(
      value,
      { viewId: "window", chatId: "chat:one", active: true, sequence: 1 },
      20,
    );
    expect(attentionCounts(value)).toMatchObject({
      messages: 1,
      mail: 1,
      agents: 1,
    });
    reportMessageView(
      value,
      { viewId: "window", chatId: "chat:one", active: false, sequence: 2 },
      30,
    );
    suppressViewedMessages(value, 40);
    expect(value.events.viewed.readAt).toBe(20);
    expect(value.events.other.readAt).toBeUndefined();
  });
  it.each([
    { active: false, at: 100 },
    { active: true, at: 100 - 12_001 },
    { active: true, at: 101 },
  ])("does not silence background, expired or future views: %j", (view) => {
    const value = state();
    value.messageViews = { window: { chatId: "chat", sequence: 1, ...view } };
    enqueueAttention(value, {
      id: "message",
      tab: "messages",
      path: "/a/messages?chatId=chat",
      at: 90,
      title: "Title",
      body: "Body",
    });
    suppressViewedMessages(value, 100);
    expect(attentionCounts(value).messages).toBe(1);
  });
  it("ignores late heartbeats after blur and keeps independent window presence", () => {
    const value = state();
    reportMessageView(
      value,
      { viewId: "one", chatId: "chat", active: false, sequence: 2 },
      100,
    );
    reportMessageView(
      value,
      { viewId: "one", chatId: "chat", active: true, sequence: 1 },
      101,
    );
    expect(value.messageViews?.one.active).toBe(false);
    reportMessageView(
      value,
      { viewId: "two", chatId: "chat", active: true, sequence: 1 },
      102,
    );
    enqueueAttention(value, {
      id: "message",
      tab: "messages",
      path: "/a/messages?chatId=chat",
      at: 103,
      title: "Title",
      body: "Body",
    });
    suppressViewedMessages(value, 104);
    expect(attentionCounts(value).messages).toBe(0);
  });
  it("deduplicates repeated events across sources and restarts", () => {
    let value = state();
    const event = {
      id: eventId("mail:a", "one"),
      tab: "mail" as const,
      title: "Sender",
      body: "Subject",
      path: "/a/mail",
      at: 10,
    };
    enqueueAttention(value, event);
    value = JSON.parse(JSON.stringify(value));
    enqueueAttention(value, { ...event, at: 20 });
    enqueueAttention(value, { ...event, id: eventId("mail:b", "one") });
    expect(attentionCounts(value).mail).toBe(2);
  });
  it("clears only the viewed tab and events actually observed", () => {
    const value = state();
    for (const [id, tab, at] of [
      ["a", "mail", 10],
      ["b", "mail", 30],
      ["c", "messages", 10],
    ] as const)
      enqueueAttention(value, {
        id,
        tab,
        at,
        title: "Title",
        body: "Body",
        path: "/a/mail",
      });
    clearAttentionTab(value, "mail", 20, 40);
    expect(attentionCounts(value)).toMatchObject({ mail: 1, messages: 1 });
  });
  it("does not announce old agent completions and never reports interrupted or failed turns as done", () => {
    const value = state();
    const agent = {
      id: "agent",
      title: "Sample",
      status: "idle",
      flags: [],
      turnId: "old",
      turnStatus: "completed",
    };
    observeAgent(value, agent, "/a/agents", 10);
    for (const turnStatus of ["inProgress", "interrupted", "failed"])
      observeAgent(
        value,
        { ...agent, turnId: "new", turnStatus },
        "/a/agents",
        20,
      );
    expect(Object.keys(value.events)).toHaveLength(0);
    observeAgent(
      value,
      { ...agent, turnId: "new", turnStatus: "completed" },
      "/a/agents",
      30,
    );
    observeAgent(
      value,
      { ...agent, turnId: "new", turnStatus: "completed" },
      "/a/agents",
      40,
    );
    expect(Object.keys(value.events)).toHaveLength(1);
  });
  it("alerts once for exposed user-input/approval waits and tolerates missing status", () => {
    const value = state();
    const agent = {
      id: "agent",
      title: "Sample",
      status: "active",
      flags: ["waitingOnUserInput"],
      turnId: "turn",
      turnStatus: "inProgress",
    };
    observeAgent(value, agent, "/a/agents", 10);
    observeAgent(value, agent, "/a/agents", 20);
    observeAgent(
      value,
      { ...agent, flags: ["waitingOnApproval"] },
      "/a/agents",
      30,
    );
    observeAgent(
      value,
      { ...agent, error: true, turnStatus: "completed" },
      "/a/agents",
      40,
    );
    expect(Object.values(value.events).map((event) => event.title)).toEqual([
      "Agent needs your answer",
      "Agent needs your answer",
    ]);
    expect(value.agents.agent.turnStatus).toBe("inProgress");
  });
});
