import { describe, expect, it } from "vitest";
import {
  moveAgentPanel,
  orderedAgentPanels,
  readPanelOrder,
} from "./panel-order";
describe("agent panel order", () => {
  it("keeps saved order through polling, omits removed panels and appends new ones", () => {
    const panels = [{ id: "a" }, { id: "b" }, { id: "new" }];
    expect(orderedAgentPanels(panels, ["removed", "b", "b", "a"])).toEqual([
      panels[1],
      panels[0],
      panels[2],
    ]);
    expect(panels.map((panel) => panel.id)).toEqual(["a", "b", "new"]);
  });
  it("moves in either direction, including between rows of four", () => {
    const ids = ["a", "b", "c", "d", "e"];
    expect(moveAgentPanel(ids, "a", "e")).toEqual(["b", "c", "d", "e", "a"]);
    expect(moveAgentPanel(ids, "e", "a")).toEqual(["e", "a", "b", "c", "d"]);
    expect(moveAgentPanel(ids, "missing", "a")).toBe(ids);
    expect(moveAgentPanel(ids, "a", "a")).toBe(ids);
  });
  it("restores saved orders and safely handles malformed storage", () => {
    expect(readPanelOrder('["b","a","b"]')).toEqual(["b", "a"]);
    expect(readPanelOrder("{bad")).toEqual([]);
    expect(readPanelOrder('["a",3]')).toEqual([]);
  });
});
