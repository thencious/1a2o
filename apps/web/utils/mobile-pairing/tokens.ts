import "server-only";
import { createHash, randomBytes } from "node:crypto";
import prisma from "@/utils/prisma";
import { SafeError } from "@/utils/error";

const TTL = 5 * 60_000;
const OWNER_PREFIX = "android-pair:";
export async function createPairingCode(userId: string) {
  const code = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TTL);
  const token = `${OWNER_PREFIX}${userId}`;
  const identifier = `android-pair-code:${hashCode(code)}`;
  // A unique owner key makes replacing a code atomic, including concurrent tabs.
  await prisma.verificationToken.upsert({
    where: { token },
    create: {
      token,
      identifier,
      expires: expiresAt,
    },
    update: { identifier, expires: expiresAt },
  });
  return { code, expiresAt: expiresAt.toISOString() };
}
export async function consumePairingCode(code: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(code))
    throw new SafeError(
      "This pairing code is invalid or has expired. Create a new code in Settings > Android.",
      401,
    );
  const identifier = `android-pair-code:${hashCode(code)}`;
  const record = await prisma.verificationToken.findFirst({
    where: { identifier },
  });
  if (
    !record?.token.startsWith(OWNER_PREFIX) ||
    record.token.length === OWNER_PREFIX.length ||
    record.expires <= new Date()
  )
    throw new SafeError(
      "This pairing code is invalid or has expired. Create a new code in Settings > Android.",
      401,
    );
  const deleted = await prisma.verificationToken.deleteMany({
    where: {
      token: record.token,
      identifier,
      expires: { gt: new Date() },
    },
  });
  if (deleted.count !== 1)
    throw new SafeError(
      "This pairing code has already been used. Create a new code in Settings > Android.",
      401,
    );
  return { userId: record.token.slice(OWNER_PREFIX.length) };
}
function hashCode(code: string) {
  return createHash("sha256").update(`android-pair:${code}`).digest("hex");
}
