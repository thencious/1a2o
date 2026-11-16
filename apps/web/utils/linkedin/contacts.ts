import { localWorkspaceRoot } from "@/utils/local-workspace";
import "server-only";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { encryptToken, decryptToken } from "@/utils/encryption";
import { SafeError } from "@/utils/error";
import type { ContactAccount } from "@/utils/beeper/contact-types";
import { LinkedInSnapshotError, readLinkedInConnections } from "./snapshot";
import {
  linkedInBrowserSession,
  readBrowserConnections,
  type ConnectionProgress,
} from "./voyager";

const storedConnection = z.object({
  userId: z.string(),
  token: z.string().optional(),
  browserSession: linkedInBrowserSession.optional(),
  progress: z.custom<ConnectionProgress>().optional(),
  nextSyncAt: z.number(),
  lastAttemptAt: z.number().default(0),
  cooldownUntil: z.number().optional(),
  requiresReconnect: z.boolean(),
  error: z.string().nullable(),
  account: z.custom<ContactAccount>(),
});
const locks = new Map<string, Promise<unknown>>();

export async function linkedInContactsStatus(userId: string) {
  const saved = await read(userId);
  const visibleAccount = saved?.progress?.contacts.length
    ? {
        ...saved.account,
        contacts: [
          ...new Map(
            [...saved.account.contacts, ...saved.progress.contacts].map(
              (contact) => [contact.id, contact],
            ),
          ).values(),
        ],
      }
    : saved?.account;
  return saved
    ? {
        connected: true,
        method: saved.browserSession
          ? ("browser" as const)
          : ("portability" as const),
        importing: Boolean(saved.progress) || !saved.account.fetchedAt,
        importedSoFar: saved.progress?.contacts.length ?? 0,
        savedCount: visibleAccount?.contacts.length ?? 0,
        pausedUntil:
          !saved.requiresReconnect &&
          saved.cooldownUntil &&
          saved.cooldownUntil > Date.now()
            ? new Date(saved.cooldownUntil).toISOString()
            : null,
        requiresReconnect: saved.requiresReconnect,
        error: saved.error,
        lastSyncAt: saved.account.fetchedAt,
        nextSyncAt: saved.requiresReconnect
          ? null
          : new Date(saved.nextSyncAt).toISOString(),
        account: visibleAccount ?? null,
      }
    : {
        connected: false,
        method: null,
        importing: false,
        importedSoFar: 0,
        savedCount: 0,
        pausedUntil: null,
        requiresReconnect: false,
        error: null,
        lastSyncAt: null,
        nextSyncAt: null,
        account: null,
      };
}

export async function acceptLinkedInBrowserSession(
  userId: string,
  browserSession: z.infer<typeof linkedInBrowserSession>,
) {
  return locked(userId, async () => {
    const previous = await read(userId);
    await save(userId, {
      userId,
      browserSession: linkedInBrowserSession.parse(browserSession),
      requiresReconnect: false,
      error: previous?.requiresReconnect ? null : (previous?.error ?? null),
      progress: previous?.progress,
      nextSyncAt:
        previous?.cooldownUntil &&
        previous.cooldownUntil > Date.now() &&
        !previous.requiresReconnect
          ? previous.cooldownUntil
          : Date.now(),
      lastAttemptAt: 0,
      cooldownUntil: previous?.requiresReconnect
        ? undefined
        : previous?.cooldownUntil,
      account: previous?.account
        ? {
            ...previous.account,
            error: previous.requiresReconnect
              ? undefined
              : previous.account.error,
            source: "linkedin-session",
          }
        : {
            id: "linkedin-direct",
            name: "LinkedIn connections",
            network: "LinkedIn",
            source: "linkedin-session",
            contacts: [],
            pages: 0,
            fetchedAt: null,
          },
    });
    return { connected: true };
  });
}

export async function connectLinkedInContacts(userId: string, token: string) {
  return locked(userId, async () => {
    let result: Awaited<ReturnType<typeof readLinkedInConnections>> | null;
    try {
      result = await readLinkedInConnections(token);
    } catch (error) {
      if (!(error instanceof LinkedInSnapshotError) || error.status !== 404)
        throw new SafeError(
          error instanceof LinkedInSnapshotError
            ? error.message
            : "Could not connect to LinkedIn. Please try again.",
        );
      result = null;
    }
    const now = Date.now();
    await save(userId, {
      userId,
      token,
      requiresReconnect: false,
      error: result
        ? null
        : "LinkedIn is preparing your connections snapshot. Sync will retry automatically.",
      nextSyncAt: now + (result ? 86_400_000 : 900_000),
      lastAttemptAt: now,
      account: {
        id: "linkedin-portability",
        name: "LinkedIn connections",
        network: "LinkedIn",
        source: "linkedin-portability",
        contacts: result?.contacts ?? [],
        pages: result?.pages ?? 0,
        fetchedAt: result ? new Date(now).toISOString() : null,
      },
    });
    return linkedInContactsStatus(userId);
  });
}

export async function syncLinkedInContacts(userId: string, force = false) {
  return locked(userId, async () => {
    const saved = await read(userId),
      now = Date.now();
    if (
      !saved ||
      saved.requiresReconnect ||
      now < (saved.cooldownUntil ?? 0) ||
      now < (force ? saved.lastAttemptAt + 60_000 : saved.nextSyncAt)
    )
      return linkedInContactsStatus(userId);
    try {
      if (saved.browserSession) {
        const result = await readBrowserConnections(
          saved.browserSession,
          saved.progress,
        );
        await save(userId, {
          ...saved,
          browserSession: result.session,
          error: result.error?.message ?? null,
          lastAttemptAt: now,
          cooldownUntil: result.error
            ? Date.now() + Math.max(900_000, result.error.retryAfterMs)
            : undefined,
          requiresReconnect:
            result.error?.status === 401 || result.error?.status === 403,
          nextSyncAt:
            Date.now() +
            (result.error
              ? Math.max(900_000, result.error.retryAfterMs)
              : result.complete
                ? 86_400_000
                : 60_000),
          progress: result.progress ?? undefined,
          account: result.complete
            ? {
                ...saved.account,
                contacts: result.contacts,
                pages: result.pages,
                error: undefined,
                fetchedAt: new Date().toISOString(),
              }
            : { ...saved.account, error: result.error?.message },
        });
        return linkedInContactsStatus(userId);
      }
      if (!saved.token)
        throw new LinkedInSnapshotError(
          401,
          "Reconnect LinkedIn to resume contacts sync.",
        );
      const result = await readLinkedInConnections(saved.token);
      await save(userId, {
        ...saved,
        error: null,
        cooldownUntil: undefined,
        lastAttemptAt: now,
        nextSyncAt: now + 86_400_000,
        account: {
          ...saved.account,
          ...result,
          error: undefined,
          fetchedAt: new Date(now).toISOString(),
        },
      });
    } catch (error) {
      const known = error instanceof LinkedInSnapshotError ? error : null;
      const message =
        known?.message ??
        "Could not reach LinkedIn. Saved contacts are retained; sync will retry automatically.";
      const requiresReconnect = known?.status === 401 || known?.status === 403;
      await save(userId, {
        ...saved,
        lastAttemptAt: now,
        requiresReconnect,
        error: message,
        cooldownUntil: now + Math.max(900_000, known?.retryAfterMs ?? 0),
        nextSyncAt: now + Math.max(900_000, known?.retryAfterMs ?? 0),
        account: { ...saved.account, error: message },
      });
    }
    return linkedInContactsStatus(userId);
  });
}

export async function disconnectLinkedInContacts(userId: string) {
  return locked(userId, async () => {
    await unlink(file(userId)).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    return { disconnected: true };
  });
}

export async function syncDueLinkedInContacts() {
  const names = await readdir(directory()).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  let checked = 0,
    failures = 0;
  for (const name of names.filter((name) =>
    /^[a-f0-9]{64}\.json$/.test(name),
  )) {
    try {
      const encoded = await readFile(resolve(directory(), name), "utf8");
      if (!encoded.startsWith("v1:"))
        throw new Error("Invalid encrypted connection");
      const saved = storedConnection.parse(
        JSON.parse(decryptToken(encoded) ?? "null"),
      );
      if (name !== `${digest(saved.userId)}.json`)
        throw new Error("Invalid connection owner");
      await syncLinkedInContacts(saved.userId);
      checked++;
    } catch {
      failures++;
    }
  }
  return { checked, failures };
}

function directory() {
  const root = localWorkspaceRoot();
  return resolve(root, ".context/linkedin-contacts");
}
function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
function file(userId: string) {
  return resolve(directory(), `${digest(userId)}.json`);
}
async function read(userId: string) {
  try {
    const encoded = await readFile(file(userId), "utf8");
    if (!encoded.startsWith("v1:"))
      throw new Error("Unencrypted LinkedIn connection");
    const saved = storedConnection.parse(
      JSON.parse(decryptToken(encoded) ?? "null"),
    );
    if (saved.userId !== userId)
      throw new Error("LinkedIn connection owner mismatch");
    return saved;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
async function save(userId: string, value: z.infer<typeof storedConnection>) {
  const encrypted = encryptToken(JSON.stringify(value));
  if (!encrypted)
    throw new SafeError("LinkedIn credential encryption is unavailable.");
  await mkdir(directory(), { recursive: true });
  const temporary = `${file(userId)}.${randomUUID()}.tmp`;
  await writeFile(temporary, encrypted, { mode: 0o600 });
  await rename(temporary, file(userId));
}
async function locked<T>(userId: string, work: () => Promise<T>): Promise<T> {
  const operation = (locks.get(userId) ?? Promise.resolve())
    .catch(() => undefined)
    .then(work);
  locks.set(userId, operation);
  try {
    return await operation;
  } finally {
    if (locks.get(userId) === operation) locks.delete(userId);
  }
}
