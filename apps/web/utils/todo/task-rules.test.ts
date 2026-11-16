import { expect, it } from "vitest";
import { defaultTaskRules, taskPolicy, taskRuleList } from "./task-rules";
it("compiles saved rules into the real calendar, urgency, analysis and reminder settings", () => {
  const rules = defaultTaskRules();
  rules.find((rule) => rule.action === "tomorrow")!.value = 4;
  rules.find((rule) => rule.action === "urgent")!.value = 6;
  rules.find((rule) => rule.action === "remind")!.value = 15;
  rules.find((rule) => rule.action === "all_day")!.enabled = false;
  rules.find((rule) => rule.action === "analyze")!.enabled = false;
  const policy = taskPolicy(rules);
  expect(policy).toMatchObject({
    lateNightHour: 4,
    urgentHours: 6,
    reminderLeadMinutes: 15,
    calendarAllDay: false,
    calendarTimed: true,
    autoAnalyze: false,
  });
  expect(policy.aiInstructions).toContain("04:00");
  rules.unshift({
    id: "custom",
    name: "Custom time policy",
    condition: "Use the sender's timezone for calendar scheduling.",
    action: "instruction",
    enabled: true,
    value: 0,
  });
  expect(taskPolicy(rules).aiInstructions.startsWith(rules[0].condition)).toBe(
    true,
  );
});
it("preserves the required duplicate check and validates editable cutoff values", () => {
  const rules = defaultTaskRules();
  expect(taskRuleList.safeParse(rules).success).toBe(true);
  expect(
    taskRuleList.safeParse(rules.filter((rule) => rule.id !== "duplicates"))
      .success,
  ).toBe(false);
  rules.find((rule) => rule.action === "tomorrow")!.value = 24;
  expect(taskRuleList.safeParse(rules).success).toBe(false);
});
