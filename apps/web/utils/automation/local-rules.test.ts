import { describe, expect, it } from "vitest";
import {
  defaultRules,
  resolveRuleChoices,
  saveLocalRules,
  type RuleItem,
} from "./local-rules";

const items: RuleItem[] = [
  { id: "chat-1", title: "Conversation", text: "Test", version: "1" },
];
describe("local labeling rules", () => {
  it("applies the configured Label as action rather than a model-generated label", () => {
    const rules = defaultRules("messages").map((rule) =>
      rule.id === "business" ? { ...rule, label: "Client work" } : rule,
    );
    const result = resolveRuleChoices(
      { results: [{ id: "chat-1", ruleId: "business", label: "invented" }] },
      rules,
      items,
    );
    expect(result.get("chat-1")?.label).toBe("Client work");
  });
  it("rejects missing, duplicate, unknown, and disabled matches", () => {
    const rules = defaultRules("messages").map((rule) => ({
      ...rule,
      enabled: rule.id !== "business",
    }));
    for (const results of [
      [],
      [{ id: "chat-1", ruleId: "unknown" }],
      [{ id: "chat-1", ruleId: "business" }],
      [
        { id: "chat-1", ruleId: "casual" },
        { id: "chat-1", ruleId: "notification" },
      ],
    ])
      expect(() => resolveRuleChoices({ results }, rules, items)).toThrow();
  });
  it("keeps unmatched conversations unlabeled and separates calendar rules", () => {
    expect(
      resolveRuleChoices(
        { results: [{ id: "chat-1", ruleId: null }] },
        defaultRules("messages"),
        items,
      ).get("chat-1")?.label,
    ).toBeNull();
    expect(defaultRules("calendars")).toEqual([]);
  });
  it("rejects duplicate rule IDs on save", () => {
    const rule = defaultRules("messages")[0];
    expect(
      saveLocalRules.safeParse({
        domain: "messages",
        revision: "x",
        enabled: true,
        rules: [rule, rule],
      }).success,
    ).toBe(false);
  });
});
