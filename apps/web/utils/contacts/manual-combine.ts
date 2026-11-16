import "server-only";
import { contactDirectory } from "./directory";
import { mergeContacts } from "./merge";
import { combinedContactName } from "./combine";
import { saveCombinedContacts } from "./save-combined";

export async function combineDirectoryContacts(
  userId: string,
  contactKeys: string[],
) {
  const keys = new Set(contactKeys);
  if (keys.size < 2 || keys.size > 20)
    throw new Error("Select between 2 and 20 contacts.");
  const directory = await contactDirectory(userId);
  const people = mergeContacts(directory.accounts).filter((person) =>
    keys.has(person.key),
  );
  if (people.length !== keys.size)
    throw new Error(
      "These contacts changed. Refresh contacts and select them again.",
    );
  const sources = people.flatMap((person) =>
    person.profiles.flatMap((profile) =>
      profile.sources.map((source) => ({
        accountId: source.account.id,
        contact: source.contact,
      })),
    ),
  );
  const name = combinedContactName(
    sources.flatMap((source) => [
      source.contact.name,
      ...(source.contact.names ?? []),
    ]),
  );
  const result = await saveCombinedContacts(userId, sources, name);
  return { id: result.contact.id, name: result.contact.name };
}
