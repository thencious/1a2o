"use server";
import { connectBeeper } from "@/utils/beeper/connection";
import {
  saveBeeperRecoveryPreferences,
  ensureBeeperSession,
} from "@/utils/beeper/session-recovery";
import { actionClientUser } from "./safe-action";
import {
  beeperToken,
  beeperRecoveryPreferences,
  beeperChat,
  beeperGroup,
  beeperSend,
  beeperMessage,
  beeperReaction,
  beeperEdit,
} from "./beeper.validation";
import {
  markConversationRead,
  setDiscordGroup,
  sendMessage,
  recallMessage,
  reactToMessage,
  editMessage,
} from "@/utils/beeper/service";
export const editBeeperMessageAction = actionClientUser
  .metadata({ name: "editBeeperMessage" })
  .inputSchema(beeperEdit)
  .action(async ({ ctx: { userId }, parsedInput }) =>
    editMessage(userId, parsedInput),
  );
export const recallBeeperMessageAction = actionClientUser
  .metadata({ name: "recallBeeperMessage" })
  .inputSchema(beeperMessage)
  .action(async ({ ctx: { userId }, parsedInput }) =>
    recallMessage(userId, parsedInput),
  );
export const reactBeeperMessageAction = actionClientUser
  .metadata({ name: "reactBeeperMessage" })
  .inputSchema(beeperReaction)
  .action(async ({ ctx: { userId }, parsedInput }) =>
    reactToMessage(userId, parsedInput),
  );
export const connectBeeperAction = actionClientUser
  .metadata({ name: "connectLocalBeeper" })
  .inputSchema(beeperToken)
  .action(async ({ ctx: { userId }, parsedInput }) =>
    connectBeeper(userId, parsedInput.token),
  );
export const readBeeperChatAction = actionClientUser
  .metadata({ name: "readBeeperChat" })
  .inputSchema(beeperChat)
  .action(async ({ ctx: { userId }, parsedInput }) =>
    markConversationRead(userId, parsedInput.chatId),
  );
export const setBeeperGroupAction = actionClientUser
  .metadata({ name: "setPrivateDiscordGroup" })
  .inputSchema(beeperGroup)
  .action(async ({ ctx: { userId }, parsedInput }) =>
    setDiscordGroup(userId, parsedInput.chatId, parsedInput.include),
  );
export const sendBeeperMessageAction = actionClientUser
  .metadata({ name: "sendBeeperMessage" })
  .inputSchema(beeperSend)
  .action(async ({ ctx: { userId }, parsedInput }) =>
    sendMessage(userId, parsedInput),
  );

export const saveBeeperRecoveryAction = actionClientUser
  .metadata({ name: "saveBeeperRecoveryPreferences" })
  .inputSchema(beeperRecoveryPreferences)
  .action(async ({ ctx: { userId }, parsedInput }) =>
    saveBeeperRecoveryPreferences(userId, parsedInput),
  );
export const verifyBeeperRecoveryAction = actionClientUser
  .metadata({ name: "verifyBeeperRecovery" })
  .action(async ({ ctx: { userId } }) => ensureBeeperSession(userId, true));
