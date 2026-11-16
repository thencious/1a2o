"use client";
import { agentCommandAction } from "@/utils/actions/agents";
import { getActionErrorMessage } from "@/utils/error";
import type { z } from "zod";
import type { agentCommand } from "@/utils/actions/agents.validation";
export async function command<T = unknown>(
  input: z.infer<typeof agentCommand>,
): Promise<T> {
  const result = await agentCommandAction(input);
  if (!result || result.serverError || result.validationErrors)
    throw new Error(getActionErrorMessage(result ?? {}));
  return result.data as T;
}
