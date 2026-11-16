import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/utils/middleware";
import { SafeError } from "@/utils/error";
import { createPairingCode } from "@/utils/mobile-pairing/tokens";
import {
  enableMobileNetwork,
  privateAddresses,
} from "@/utils/mobile-pairing/network";
import prisma from "@/utils/prisma";
import { revokeCloudDevice } from "@/utils/todo/cloud-device";
import { checkRateLimit, createRateLimitKey } from "@/utils/rate-limit";

export const GET = withAuth("mobile/pair", async (request) => {
  const prefix = `android-device:${request.auth.userId}:`;
  const records = await prisma.verificationToken.findMany({
    where: { identifier: { startsWith: prefix }, expires: { gt: new Date() } },
  });
  const sessions = await prisma.session.findMany({
    where: { userId: request.auth.userId, expires: { gt: new Date() } },
    select: { id: true },
  });
  const active = new Set(sessions.map((session) => session.id));
  const devices = records.flatMap((record) => {
    try {
      const data = JSON.parse(record.identifier.slice(prefix.length));
      return active.has(data.sessionId)
        ? [{ id: record.token, name: data.name, createdAt: data.createdAt }]
        : [];
    } catch {
      return [];
    }
  });
  return NextResponse.json(
    { devices, addresses: privateAddresses() },
    { headers: { "Cache-Control": "no-store" } },
  );
});
export const POST = withAuth("mobile/pair", async (request) => {
  assertOrigin(request);
  const body = z
    .object({ enableLocalNetwork: z.boolean().optional() })
    .parse(await request.json());
  const limit = await checkRateLimit({
    rule: {
      key: createRateLimitKey(["mobile-pair-create", request.auth.userId]),
      limit: 10,
      windowSeconds: 60,
    },
    logger: request.logger,
  });
  if (limit.limited)
    throw new SafeError(
      "Please wait a minute before creating another pairing code.",
      429,
    );
  if (body.enableLocalNetwork) {
    const host = new URL(request.url).hostname;
    if (!["localhost", "127.0.0.1", "[::1]"].includes(host))
      throw new SafeError(
        "Enable local-network access from this computer's localhost app.",
        403,
      );
    const owner =
      process.env.LOCAL_BEEPER_OWNER_ID || process.env.LOCAL_AGENTS_OWNER_ID;
    if (owner && request.auth.userId !== owner)
      throw new SafeError(
        "Only this installation's owner can enable local-network access.",
        403,
      );
    await enableMobileNetwork();
  }
  return NextResponse.json(
    {
      ...(await createPairingCode(request.auth.userId)),
      addresses: privateAddresses(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
export const DELETE = withAuth("mobile/pair", async (request) => {
  assertOrigin(request);
  const { id } = z
    .object({ id: z.string().min(1).max(256) })
    .parse(await request.json());
  const prefix = `android-device:${request.auth.userId}:`;
  const record = await prisma.verificationToken.findUnique({
    where: { token: id },
  });
  if (!record?.identifier.startsWith(prefix))
    throw new SafeError("Device not found", 404);
  const data = JSON.parse(record.identifier.slice(prefix.length));
  await revokeCloudDevice(request.auth.userId, data.sessionId);
  await prisma.session.deleteMany({
    where: { id: data.sessionId, userId: request.auth.userId },
  });
  await prisma.verificationToken.deleteMany({
    where: { token: id, identifier: record.identifier },
  });
  return NextResponse.json({ removed: true });
});
function assertOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    throw new SafeError("Open this setting in your 1a2o app.", 403);
}
