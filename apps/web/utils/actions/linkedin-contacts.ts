"use server";
import { actionClientUser } from "./safe-action";
import { linkedInAccessToken } from "./linkedin-contacts.validation";
import {
  startLinkedInSignIn,
  cancelLinkedInSignIn,
} from "@/utils/linkedin/sign-in";
import {
  connectLinkedInContacts,
  disconnectLinkedInContacts,
  syncLinkedInContacts,
} from "@/utils/linkedin/contacts";

export const connectLinkedInContactsAction = actionClientUser
  .metadata({ name: "connectLinkedInContacts" })
  .inputSchema(linkedInAccessToken)
  .action(async ({ ctx: { userId }, parsedInput }) =>
    connectLinkedInContacts(userId, parsedInput.token),
  );
export const disconnectLinkedInContactsAction = actionClientUser
  .metadata({ name: "disconnectLinkedInContacts" })
  .action(async ({ ctx: { userId } }) => {
    cancelLinkedInSignIn(userId);
    return disconnectLinkedInContacts(userId);
  });
export const startLinkedInSignInAction = actionClientUser
  .metadata({ name: "startLinkedInSignIn" })
  .action(async ({ ctx: { userId } }) => startLinkedInSignIn(userId));
export const cancelLinkedInSignInAction = actionClientUser
  .metadata({ name: "cancelLinkedInSignIn" })
  .action(async ({ ctx: { userId } }) => {
    cancelLinkedInSignIn(userId);
    return { cancelled: true };
  });
export const syncLinkedInContactsAction = actionClientUser
  .metadata({ name: "syncLinkedInContacts" })
  .action(async ({ ctx: { userId } }) => syncLinkedInContacts(userId, true));
