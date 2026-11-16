import { describe, expect, it } from "vitest";
import { insertTab, orderedTabs, parseTabOrder } from "./tab-order";

describe("sidebar tab order", () => {
  it("matches insertion lines when moving upwards or downwards", () => {
    const ids = ["mail", "messages", "todo", "notes", "tools"];
    expect(insertTab(ids, "notes", "messages", "before")).toEqual([
      "mail",
      "notes",
      "messages",
      "todo",
      "tools",
    ]);
    expect(insertTab(ids, "mail", "notes", "after")).toEqual([
      "messages",
      "todo",
      "notes",
      "mail",
      "tools",
    ]);
    expect(insertTab(ids, "mail", "mail", "after")).toBe(ids);
    expect(insertTab(ids, "missing", "mail", "before")).toBe(ids);
  });
  it("restores persisted order across accounts, appends new tabs and ignores unavailable ones", () => {
    const items = [{ id: "mail" }, { id: "notes" }, { id: "tools" }];
    const raw = JSON.stringify(["tools", "unavailable", "mail", "mail"]);
    expect(orderedTabs(items, parseTabOrder(raw))).toEqual([
      items[2],
      items[0],
      items[1],
    ]);
  });
  it("handles malformed storage without losing tabs", () => {
    expect(parseTabOrder("bad")).toEqual([]);
    expect(parseTabOrder('["mail",3]')).toEqual([]);
  });
});
