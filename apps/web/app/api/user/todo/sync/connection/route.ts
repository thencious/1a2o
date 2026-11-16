import { NextResponse } from "next/server";
import { withAuth } from "@/utils/middleware";
import { getCloudDeviceConnection } from "@/utils/todo/cloud-device";
import { auth } from "@/utils/auth";
import prisma from "@/utils/prisma";
import { SafeError } from "@/utils/error";
export const GET = withAuth("todo/sync/connection", async (request) => {
  const session = await auth(request.headers);
  if (!session?.session?.id)
    throw new SafeError("Sign in again to connect private cloud sync.", 401);
  const active = await prisma.session.findFirst({
    where: {
      id: session.session.id,
      userId: request.auth.userId,
      expires: { gt: new Date() },
    },
    select: { id: true },
  });
  if (!active)
    throw new SafeError("Sign in again to connect private cloud sync.", 401);
  const connection = await getCloudDeviceConnection(
    request.auth.userId,
    session.session.id,
  );
  return NextResponse.json(
    connection ? { enabled: true, ...connection } : { enabled: false },
    {
      headers: {
        "Cache-Control": "private, no-store",
        Vary: "Cookie",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
});
