"use server";
import { z } from "zod";
import { actionClientUser } from "./safe-action";
import { getConversationInviteContext } from "@/utils/beeper/service";
import {
  conversationGroups,
  saveConversationGroup,
} from "@/utils/messages/conversation-group-store";
import { contactDirectory } from "@/utils/contacts/directory";
import { updateSavedContacts } from "@/utils/contacts/local-store";
import {
  combineContactDetails,
  combinedContactName,
  conversationContacts,
} from "@/utils/contacts/combine";
import type { Conversation } from "@/utils/beeper/types";
export const combineConversationsAction = actionClientUser
  .metadata({ name: "combineConversations" })
  .inputSchema(
    z.object({
      chatIds: z.array(z.string().min(1).max(2048)).min(2).max(20),
      combineContacts: z.boolean(),
    }),
  )
  .action(async ({ ctx: { userId }, parsedInput }) => {
    const groups = await conversationGroups(userId);
    const ids = [
      ...new Set(
        parsedInput.chatIds.flatMap(
          (id) =>
            groups
              .find((group) => group.id === id)
              ?.members.map((member) => member.id) ?? [id],
        ),
      ),
    ];
    if (ids.length < 2) throw new Error("Select at least two conversations.");
    if (ids.length > 20)
      throw new Error("Select no more than 20 conversations.");
    const contexts = await Promise.all(
      ids.map((id) => getConversationInviteContext(userId, id, 0)),
    );
    let title = combinedContactName(contexts.map((context) => context.title));
    if (parsedInput.combineContacts) {
      const directory = await contactDirectory(userId);
      const sources = contexts.flatMap((context) => {
        if (context.type !== "single") return [];
        const people = context.participants.filter((person) => !person.self);
        return [
          ...conversationContacts(
            directory.accounts,
            people,
            context.accountId,
          ),
          ...people.map((person) => ({
            accountId: context.accountId,
            contact: {
              id: person.id,
              name: person.name,
              phoneNumber: person.phoneNumber,
              email: person.email,
              username: person.username,
            },
          })),
        ];
      });
      if (sources.length) {
        title = combinedContactName(
          sources.map((source) => source.contact.name),
        );
        await updateSavedContacts(userId, async (stored) => {
          const localIds = new Set(
            sources
              .filter((source) => source.accountId === "zenro:contacts")
              .map((source) => source.contact.id),
          );
          const current = stored.filter((contact) => localIds.has(contact.id));
          const merged = combineContactDetails(
            [
              ...sources,
              ...current.map((contact) => ({
                accountId: "zenro:contacts",
                contact,
              })),
            ],
            title,
          );
          merged.id = current[0]?.id ?? `combined:${crypto.randomUUID()}`;
          return {
            contacts: [
              ...stored.filter((contact) => !localIds.has(contact.id)),
              merged,
            ],
          };
        });
      }
    }
    const members: Conversation[] = contexts.map((context, index) => ({
      id: ids[index],
      title: context.title,
      accountId: context.accountId,
      account: context.account,
      network: context.network,
      group: context.type === "group",
      unread: 0,
      time: context.time,
      preview: context.preview,
      readOnly: context.readOnly,
    }));
    return saveConversationGroup(userId, { id: ids[0], title, members });
  });
