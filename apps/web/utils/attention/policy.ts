import { createHash } from "node:crypto";
import {
  attentionTabs,
  type AgentAttentionSnapshot,
  type AttentionEvent,
  type AttentionState,
  type AttentionTab,
} from "./types";

export function eventId(source: string, id: string) {
  return createHash("sha256")
    .update(JSON.stringify([source, id]))
    .digest("hex");
}
export function enqueueAttention(state: AttentionState, event: AttentionEvent) {
  if (!state.events[event.id]) state.events[event.id] = event;
}
export function attentionCounts(state: AttentionState) {
  return Object.fromEntries(
    attentionTabs.map((tab) => [
      tab,
      Object.values(state.events).filter(
        (event) => event.tab === tab && !event.readAt,
      ).length,
    ]),
  ) as Record<AttentionTab, number>;
}
export function clearAttentionTab(
  state: AttentionState,
  tab: AttentionTab,
  through: number,
  now = Date.now(),
) {
  for (const event of Object.values(state.events))
    if (event.tab === tab && event.at <= Math.min(through, now))
      event.readAt = now;
}
export function reportMessageView(
  state: AttentionState,
  input: { viewId: string; chatId: string; active: boolean; sequence: number },
  now = Date.now(),
) {
  state.messageViews ??= {};
  const views = state.messageViews;
  const previous = views[input.viewId];
  if (previous && previous.sequence >= input.sequence) return;
  views[input.viewId] = {
    chatId: input.chatId,
    active: input.active,
    sequence: input.sequence,
    at: now,
  };
  for (const [id, view] of Object.entries(views))
    if (now - view.at > 180_000) delete views[id];
  suppressViewedMessages(state, now);
}
export function suppressViewedMessages(
  state: AttentionState,
  now = Date.now(),
) {
  const active = new Set(
    Object.values(state.messageViews ?? {})
      .filter(
        (view) => view.active && now >= view.at && now - view.at <= 12_000,
      )
      .map((view) => view.chatId),
  );
  if (!active.size) return;
  for (const event of Object.values(state.events)) {
    if (event.tab !== "messages" || event.readAt) continue;
    try {
      const path = new URL(event.path, "http://localhost:3000");
      if (active.has(path.searchParams.get("chatId") ?? "")) event.readAt = now;
    } catch {
      /* Malformed destinations must never silence unrelated alerts. */
    }
  }
}
export function observeAgent(
  state: AttentionState,
  agent: AgentAttentionSnapshot,
  path: string,
  now = Date.now(),
) {
  if (agent.error) return;
  const previous = state.agents[agent.id];
  const waiting = agent.flags.some(
    (flag) => flag === "waitingOnApproval" || flag === "waitingOnUserInput",
  );
  const wasWaiting = previous?.flags.some(
    (flag) => flag === "waitingOnApproval" || flag === "waitingOnUserInput",
  );
  const waitingEpisode =
    (previous?.waitingEpisode ?? 0) +
    (waiting &&
    (!wasWaiting ||
      previous?.turnId !== agent.turnId ||
      previous?.flags.slice().sort().join(",") !==
        agent.flags.slice().sort().join(","))
      ? 1
      : 0);
  if (waiting)
    enqueueAttention(state, {
      id: eventId(
        "agents",
        `${agent.id}:${agent.turnId || "current"}:${waitingEpisode}:${agent.flags.slice().sort().join(",")}`,
      ),
      tab: "agents",
      title: "Agent needs your answer",
      body: agent.title,
      path,
      at: now,
    });
  else if (
    previous &&
    (agent.status === "idle" || agent.status === "notLoaded") &&
    agent.turnId &&
    agent.turnStatus === "completed" &&
    (previous.status === "active" ||
      previous.turnId !== agent.turnId ||
      previous.turnStatus !== "completed")
  )
    enqueueAttention(state, {
      id: eventId("agents", `${agent.id}:${agent.turnId}:completed`),
      tab: "agents",
      title: "Agent finished its task",
      body: agent.title,
      path,
      at: now,
    });
  state.agents[agent.id] = { ...agent, waitingEpisode };
}
