export type AgentPanel = {
  id: string;
  chat_id: string;
  chat_title: string;
  cwd: string;
  model: string;
  effort: string;
  message: string;
  cwd_manual: boolean;
  taskId: string | null;
  taskIds?: string[];
  new_chat?: boolean;
};
export type AgentTask = {
  message?: string;
  model?: string;
  effort?: string;
  id: string;
  status: string;
  due: number | null;
  remaining: number;
  error: string;
  delay: string;
  default_timer: boolean;
  default_due: number | null;
};
export type AgentsState = { panels: AgentPanel[]; tasks: AgentTask[] };
export type AgentsMetadata = {
  chats: { id: string; title: string; cwd: string; model: string }[];
  levels: Record<string, string[]>;
  reset: { resets_at: number; send_at: number; used_percent: number } | null;
  resetError: string;
};
