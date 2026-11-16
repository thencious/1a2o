"use server";
import { actionClientUser } from "./safe-action";
import { chatGPTConfiguration } from "./chatgpt.validation";
import { startChatGPTLogin } from "@/utils/chatgpt/oauth";
import { configureChatGPT } from "@/utils/chatgpt/service";
export const startChatGPTLoginAction = actionClientUser
  .metadata({ name: "startChatGPTLogin" })
  .action(async ({ ctx: { userId } }) => startChatGPTLogin(userId));
export const configureChatGPTAction = actionClientUser
  .metadata({ name: "configureChatGPT" })
  .inputSchema(chatGPTConfiguration)
  .action(async ({ ctx: { userId }, parsedInput }) =>
    configureChatGPT(userId, parsedInput),
  );
