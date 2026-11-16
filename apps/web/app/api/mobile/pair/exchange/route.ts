import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { withError } from "@/utils/middleware";
import { betterAuthConfig } from "@/utils/auth";
import { buildMobileSessionCookie } from "@/utils/mobile-auth/session-cookie";
import { consumePairingCode } from "@/utils/mobile-pairing/tokens";
import prisma from "@/utils/prisma";
import {
  checkRateLimit,
  createRateLimitKey,
  getClientIp,
  hashRateLimitValue,
} from "@/utils/rate-limit";
import { SafeError } from "@/utils/error";

export const POST = withError("mobile/pair/exchange", async (request) => {
  const body = z
    .object({
      code: z.string().trim().length(43),
      deviceName: z.string().trim().min(1).max(80).default("Android device"),
    })
    .parse(await request.json());
  const limit = await checkRateLimit({
    rule: {
      key: createRateLimitKey([
        "mobile-pair-exchange",
        hashRateLimitValue(getClientIp(request.headers)),
      ]),
      limit: 20,
      windowSeconds: 60,
    },
    logger: request.logger,
  });
  if (limit.limited)
    throw new SafeError(
      "Too many pairing attempts. Wait a minute and try again.",
      429,
    );
  const { userId } = await consumePairingCode(body.code);
  const authContext = await betterAuthConfig.$context;
  const session = await authContext.internalAdapter.createSession(
    userId,
    false,
    {},
  );
  if (!session?.token)
    throw new SafeError(
      "Could not create a device session. Generate a new pairing code.",
      500,
    );
  const cookie = await buildMobileSessionCookie({
    authContext,
    expiresAt: session.expiresAt,
    sessionToken: session.token,
  });
  const response = new NextResponse(null);
  response.cookies.set(cookie.name, cookie.value, {
    ...cookie.options,
    domain: undefined,
  });
  const serialized = response.headers.get("set-cookie");
  const account = await prisma.emailAccount.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  await prisma.verificationToken.create({
    data: {
      token: `android-device:${randomUUID()}`,
      identifier: `android-device:${userId}:${JSON.stringify({ sessionId: session.id, name: body.deviceName, createdAt: new Date().toISOString() })}`,
      expires: session.expiresAt,
    },
  });
  return NextResponse.json(
    {
      cookie: serialized,
      redirectPath: account
        ? `/${encodeURIComponent(account.id)}/mail?accountScope=all`
        : "/accounts",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
