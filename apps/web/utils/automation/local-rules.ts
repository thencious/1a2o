import { z } from "zod";

export const ruleDomain = z.enum(["messages", "calendars"]);
export type RuleDomain = z.infer<typeof ruleDomain>;
export const localRule = z.object({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(100),
  condition: z.string().trim().min(1).max(4000),
  action: z.literal("label"),
  label: z.string().trim().min(1).max(60),
  enabled: z.boolean(),
});
export type LocalRule = z.infer<typeof localRule>;
export const saveLocalRules = z
  .object({
    domain: ruleDomain,
    revision: z.string(),
    enabled: z.boolean(),
    rules: z.array(localRule).max(50),
  })
  .refine(
    (value) =>
      new Set(value.rules.map((rule) => rule.id)).size === value.rules.length,
    "Rule IDs must be unique.",
  );
export type RuleItem = {
  id: string;
  title: string;
  text: string;
  account?: string;
  network?: string;
  version: string;
};
export type RuleResult = {
  fingerprint: string;
  revision: string;
  label: string | null;
  ruleId: string | null;
  at: string;
  lastAttemptAt?: string;
};
export type RuleHistory = {
  id: string;
  title: string;
  label: string | null;
  ruleName: string;
  at: string;
};
export type RuleSettings = {
  revision: string;
  enabled: boolean;
  rules: LocalRule[];
  history: RuleHistory[];
  results: Record<string, RuleResult>;
  retryAt: number;
  lastError?: string;
};

export function defaultRules(domain: RuleDomain): LocalRule[] {
  if (domain === "calendars") return [];
  return [
    {
      id: "business",
      name: "Business conversations",
      condition:
        "Work, clients, professional collaboration, recruiting, business opportunities, or professional networking. Judge the purpose of the whole conversation, not isolated words or the network alone.",
      label: "Business",
    },
    {
      id: "casual",
      name: "Casual conversations",
      condition:
        "Personal conversations with friends or family, social plans, hobbies, gaming, or informal group discussions unrelated to work.",
      label: "Casual",
    },
    {
      id: "notification",
      name: "Notifications",
      condition:
        "Automated or transactional messages such as verification codes, delivery updates, receipts, account alerts, or automated announcements, rather than a conversation with a person.",
      label: "Notification",
    },
    {
      id: "other",
      name: "Other conversations",
      condition:
        "Fallback: use only when none of the preceding enabled rules matches or context is insufficient.",
      label: "Other",
    },
  ].map((rule) => ({ ...rule, action: "label" as const, enabled: true }));
}

export function resolveRuleChoices(
  raw: unknown,
  rules: LocalRule[],
  items: RuleItem[],
) {
  const parsed = z
    .object({
      results: z.array(
        z.object({ id: z.string(), ruleId: z.string().nullable() }),
      ),
    })
    .parse(raw);
  const choices = new Map<
    string,
    { ruleId: string | null; label: string | null; ruleName: string }
  >();
  for (const item of items) {
    const matches = parsed.results.filter((result) => result.id === item.id);
    if (matches.length !== 1)
      throw new Error("The classifier omitted or duplicated an item.");
    const rule = rules.find(
      (rule) => rule.enabled && rule.id === matches[0].ruleId,
    );
    if (matches[0].ruleId !== null && !rule)
      throw new Error("The classifier returned an unknown rule.");
    choices.set(item.id, {
      ruleId: rule?.id ?? null,
      label: rule?.label ?? null,
      ruleName: rule?.name ?? "No matching rule",
    });
  }
  return choices;
}
