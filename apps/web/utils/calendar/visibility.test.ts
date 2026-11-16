import { describe, expect, it } from "vitest";
import { applyCalendarVisibility } from "./visibility";
describe("saved calendar visibility", () => {
  it("does not overwrite existing choices when another device initializes", () => {
    expect(
      applyCalendarVisibility(
        { visibleIds: ["work"] },
        { operation: "initialize", ids: ["work", "holiday"] },
      ),
    ).toEqual({ visibleIds: ["work"] });
    expect(
      applyCalendarVisibility(
        { visibleIds: [] },
        { operation: "initialize", ids: ["work"] },
      ),
    ).toEqual({ visibleIds: [] });
  });
  it("persists explicit choices without automatically adding new calendars", () => {
    const first = applyCalendarVisibility(
      { visibleIds: null },
      { operation: "initialize", ids: ["work", "holiday"] },
    );
    const hidden = applyCalendarVisibility(first, {
      operation: "toggle",
      id: "holiday",
      visible: false,
    });
    const reloaded = JSON.parse(JSON.stringify(hidden));
    expect(
      applyCalendarVisibility(reloaded, {
        operation: "initialize",
        ids: ["work", "holiday", "new"],
      }),
    ).toEqual({ visibleIds: ["work"] });
    expect(
      applyCalendarVisibility(hidden, {
        operation: "toggle",
        id: "personal",
        visible: true,
      }),
    ).toEqual({ visibleIds: ["work", "personal"] });
  });
  it("distinguishes hiding everything from an unconfigured selection", () => {
    expect(
      applyCalendarVisibility(
        { visibleIds: ["work"] },
        { operation: "replace", ids: [] },
      ),
    ).toEqual({ visibleIds: [] });
  });
});
