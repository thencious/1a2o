"use server";
import { actionClientUser } from "./safe-action";
import { prepareMessageInvite } from "./message-invite.validation";
import { prepareConversationInvite } from "@/utils/messages/invite-service";
export const prepareMessageInviteAction = actionClientUser
  .metadata({ name: "prepareMessageInvite" })
  .inputSchema(prepareMessageInvite)
  .action(async ({ ctx: { userId }, parsedInput }) =>
    prepareConversationInvite(userId, parsedInput.chatId, parsedInput.timezone),
  );
