"use server";
import { actionClientUser } from "./safe-action";
import { addMessageContacts } from "./message-add-contacts.validation";
import { addConversationContacts } from "@/utils/messages/add-contacts-service";
export const addMessageContactsAction = actionClientUser
  .metadata({ name: "addMessageContacts" })
  .inputSchema(addMessageContacts)
  .action(async ({ ctx: { userId }, parsedInput }) =>
    addConversationContacts(userId, parsedInput.chatId),
  );
