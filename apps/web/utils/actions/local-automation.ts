"use server";
import { z } from "zod";
import { actionClientUser } from "./safe-action";
import { ruleDomain, saveLocalRules } from "@/utils/automation/local-rules";
import {
  setLocalRules,
  testLocalRules,
} from "@/utils/automation/local-rules-service";

export const saveLocalAutomationAction = actionClientUser
  .metadata({ name: "saveLocalAutomationRules" })
  .inputSchema(saveLocalRules)
  .action(async ({ ctx: { userId }, parsedInput }) =>
    setLocalRules(userId, parsedInput),
  );
export const testLocalAutomationAction = actionClientUser
  .metadata({ name: "testLocalAutomationRules" })
  .inputSchema(
    z.object({
      domain: ruleDomain,
      text: z.string().trim().min(1).max(16_000),
    }),
  )
  .action(async ({ ctx: { userId }, parsedInput }) =>
    testLocalRules(userId, parsedInput.domain, parsedInput.text),
  );
