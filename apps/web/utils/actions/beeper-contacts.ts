"use server";
import { actionClientUser } from "./safe-action";
import { syncBeeperContacts } from "@/utils/beeper/contacts";
import { syncLinkedInContacts } from "@/utils/linkedin/contacts";
import { syncEmailContacts } from "@/utils/contacts/email-store";
import { contactDirectory } from "@/utils/contacts/directory";

export const refreshBeeperContactsAction = actionClientUser
  .metadata({ name: "refreshBeeperContacts" })
  .action(async ({ ctx: { userId } }) => {
    await Promise.allSettled([
      syncLinkedInContacts(userId, true),
      syncBeeperContacts(userId),
      syncEmailContacts(userId, true),
    ]);
    return contactDirectory(userId);
  });
