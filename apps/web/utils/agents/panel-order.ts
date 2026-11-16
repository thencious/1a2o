export const AGENT_PANEL_ORDER_KEY = "zenro:agent-panel-order:v1";

export function readPanelOrder(raw: string | null): string[] {
  try {
    const value: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(value) && value.every((id) => typeof id === "string")
      ? [...new Set(value)]
      : [];
  } catch {
    return [];
  }
}

export function orderedAgentPanels<T extends { id: string }>(
  panels: T[],
  order: string[],
): T[] {
  const remaining = new Map(panels.map((panel) => [panel.id, panel]));
  const result: T[] = [];
  for (const id of order) {
    const panel = remaining.get(id);
    if (panel) {
      result.push(panel);
      remaining.delete(id);
    }
  }
  return [...result, ...remaining.values()];
}

export function moveAgentPanel(
  ids: string[],
  source: string,
  target: string,
): string[] {
  const from = ids.indexOf(source),
    to = ids.indexOf(target);
  if (from < 0 || to < 0 || from === to) return ids;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, source);
  return next;
}
