export const attentionTabs = ["mail", "messages", "todo", "agents"] as const;
export type AttentionTab = (typeof attentionTabs)[number];
export type AttentionEvent = {
  id: string;
  tab: AttentionTab;
  title: string;
  body: string;
  path: string;
  at: number;
  deliveredAt?: number;
  readAt?: number;
};
export type AgentAttentionSnapshot = {
  id: string;
  title: string;
  status: string;
  flags: string[];
  turnId?: string;
  turnStatus?: string;
  error?: boolean;
  waitingEpisode?: number;
};
export type AttentionState = {
  messageViews?: Record<
    string,
    { chatId: string; active: boolean; at: number; sequence: number }
  >;
  startedAt: number;
  checkpoints: Record<string, number>;
  events: Record<string, AttentionEvent>;
  agents: Record<string, AgentAttentionSnapshot>;
};
