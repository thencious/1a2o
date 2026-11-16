export function chatControlShortcut(
  event: Pick<
    KeyboardEvent,
    "key" | "shiftKey" | "ctrlKey" | "altKey" | "metaKey" | "isComposing"
  >,
  state: {
    model: string | null;
    reasoningEffort: string | null;
    models: readonly {
      id: string;
      reasoningLevels?: readonly { effort: string }[];
    }[];
  },
): { mode: "model" | "reasoning"; value: string | undefined } | null {
  if (
    event.isComposing ||
    !event.shiftKey ||
    event.altKey ||
    event.metaKey ||
    !["ArrowUp", "ArrowDown"].includes(event.key)
  )
    return null;
  const mode = event.ctrlKey ? "model" : "reasoning";
  const values =
    mode === "model"
      ? state.models.map((model) => model.id)
      : (state.models
          .find((model) => model.id === state.model)
          ?.reasoningLevels?.map((level) => level.effort) ?? []);
  const current = mode === "model" ? state.model : state.reasoningEffort;
  const index = values.indexOf(current ?? "");
  const direction =
    (event.key === "ArrowUp" ? 1 : -1) * (mode === "model" ? -1 : 1);
  const next = index < 0 ? undefined : values[index + direction];
  return { mode, value: next };
}
