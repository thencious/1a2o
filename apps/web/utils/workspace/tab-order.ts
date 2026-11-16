export function parseTabOrder(raw: string | null): string[] {
  try {
    const value: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(value) && value.every((id) => typeof id === "string")
      ? [...new Set(value)]
      : [];
  } catch {
    return [];
  }
}

export function orderedTabs<T extends { id: string }>(
  items: T[],
  saved: string[],
): T[] {
  const remaining = new Map(items.map((item) => [item.id, item]));
  const result: T[] = [];
  for (const id of saved) {
    const item = remaining.get(id);
    if (item) {
      result.push(item);
      remaining.delete(id);
    }
  }
  return [...result, ...remaining.values()];
}

export function insertTab(
  ids: string[],
  source: string,
  target: string,
  side: "before" | "after",
): string[] {
  if (source === target || !ids.includes(source) || !ids.includes(target))
    return ids;
  const remaining = ids.filter((id) => id !== source);
  remaining.splice(
    remaining.indexOf(target) + (side === "after" ? 1 : 0),
    0,
    source,
  );
  return remaining;
}
