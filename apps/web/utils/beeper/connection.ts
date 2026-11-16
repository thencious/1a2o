import { localWorkspaceRoot } from "@/utils/local-workspace";
import "server-only";
import BeeperDesktop from "@beeper/desktop-api";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { env } from "@/env";
import { SafeError } from "@/utils/error";
import { encryptToken, decryptToken } from "@/utils/encryption";
export function assertBeeperOwner(userId: string) {
  if (
    env.LOCAL_BEEPER_ENABLED !== "true" ||
    env.LOCAL_BEEPER_OWNER_ID !== userId
  )
    throw new SafeError(
      "Messages is available only to the configured owner of this installation.",
    );
}
export function beeperDirectory() {
  const root = localWorkspaceRoot();
  return resolve(root, ".context/beeper");
}
type Connection = { owner: string; token: string; groups: string[] };
export async function beeperConnection(
  userId: string,
): Promise<Connection | null> {
  assertBeeperOwner(userId);
  try {
    const value = JSON.parse(
      await readFile(resolve(beeperDirectory(), "connection.json"), "utf8"),
    ) as Connection;
    if (value.owner !== userId || !value.token.startsWith("v1:"))
      throw new SafeError("Reconnect Beeper to this account.");
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
export async function saveBeeperConnection(value: Connection) {
  assertBeeperOwner(value.owner);
  await mkdir(beeperDirectory(), { recursive: true });
  const temporary = resolve(
    beeperDirectory(),
    `connection-${randomUUID()}.tmp`,
  );
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await rename(temporary, resolve(beeperDirectory(), "connection.json"));
}
function client(token: string) {
  return new BeeperDesktop({
    accessToken: token,
    baseURL: "http://127.0.0.1:23373",
    timeout: 15_000,
    maxRetries: 0,
    logLevel: "off",
  });
}
export async function beeperSession(userId: string) {
  const value = await beeperConnection(userId);
  const token = value && decryptToken(value.token);
  if (!value || !token)
    throw new SafeError(
      "Connect Beeper Desktop under Messages settings first.",
    );
  return { client: client(token), settings: value };
}
export async function connectBeeper(userId: string, token: string) {
  assertBeeperOwner(userId);
  try {
    await client(token).accounts.list();
  } catch {
    throw new SafeError(
      "Could not connect. Keep Beeper running, enable its Desktop API, and check the access token.",
    );
  }
  const encrypted = encryptToken(token);
  if (!encrypted)
    throw new SafeError("Application encryption is not configured.");
  const previous = await beeperConnection(userId);
  await saveBeeperConnection({
    owner: userId,
    token: encrypted,
    groups: previous?.groups ?? [],
  });
  return { connected: true };
}
