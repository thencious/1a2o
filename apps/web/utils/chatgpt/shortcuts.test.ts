import { expect, it } from "vitest";
import { chatControlShortcut } from "./shortcuts";
const state = {
  model: "sol",
  reasoningEffort: "medium",
  models: [
    {
      id: "sol",
      reasoningLevels: [
        { effort: "low" },
        { effort: "medium" },
        { effort: "high" },
      ],
    },
    {
      id: "astra",
      reasoningLevels: [{ effort: "medium" }, { effort: "high" }],
    },
  ],
};
const key = (key = "ArrowUp", extra = {}) => ({
  key,
  shiftKey: true,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  isComposing: false,
  ...extra,
});
it("raises/lowers thinking without wrapping at its supported limits", () => {
  expect(chatControlShortcut(key(), state)).toEqual({
    mode: "reasoning",
    value: "high",
  });
  expect(chatControlShortcut(key("ArrowDown"), state)).toEqual({
    mode: "reasoning",
    value: "low",
  });
  expect(
    chatControlShortcut(key(), { ...state, reasoningEffort: "high" })?.value,
  ).toBeUndefined();
  expect(
    chatControlShortcut(key("ArrowDown"), { ...state, reasoningEffort: "low" })
      ?.value,
  ).toBeUndefined();
});
it("uses Ctrl+Shift for the previous/next model and respects the first/last boundaries", () => {
  expect(
    chatControlShortcut(key("ArrowDown", { ctrlKey: true }), state),
  ).toEqual({ mode: "model", value: "astra" });
  expect(
    chatControlShortcut(key("ArrowUp", { ctrlKey: true }), {
      ...state,
      model: "astra",
    }),
  ).toEqual({ mode: "model", value: "sol" });
  expect(
    chatControlShortcut(key("ArrowUp", { ctrlKey: true }), state)?.value,
  ).toBeUndefined();
  expect(
    chatControlShortcut(key("ArrowDown", { ctrlKey: true }), {
      ...state,
      model: "astra",
    })?.value,
  ).toBeUndefined();
});
it.each([
  { shiftKey: false },
  { altKey: true },
  { metaKey: true },
  { isComposing: true },
  { key: "ArrowLeft" },
])("preserves unrelated shortcuts and composition: %j", (extra) => {
  expect(chatControlShortcut(key("ArrowUp", extra), state)).toBeNull();
});
it("does not guess a selection while the current model or effort is unavailable", () => {
  expect(
    chatControlShortcut(key(), { ...state, model: "missing" })?.value,
  ).toBeUndefined();
  expect(
    chatControlShortcut(key(), { ...state, reasoningEffort: null })?.value,
  ).toBeUndefined();
});
