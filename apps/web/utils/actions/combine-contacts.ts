"use server";
import { actionClientUser } from "./safe-action";
import { combineContactsSchema } from "./combine-contacts.validation";
import { combineDirectoryContacts } from "@/utils/contacts/manual-combine";

export const combineContactsAction = actionClientUser
  .metadata({ name: "combineContacts" })
  .inputSchema(combineContactsSchema)
  .action(async ({ ctx: { userId }, parsedInput }) =>
    combineDirectoryContacts(userId, parsedInput.contactKeys),
  );
