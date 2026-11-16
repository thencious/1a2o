import { z } from "zod";
export const chatGPTReasoningEffort = z.enum([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
export const chatGPTConfiguration = z.object({
  mode: z.enum(["chatgpt", "openrouter", "disconnect", "model", "reasoning"]),
  model: z.string().max(200).optional(),
  reasoningEffort: chatGPTReasoningEffort.optional(),
});
