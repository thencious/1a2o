import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { withAuth } from "@/utils/middleware";
import { localWorkspaceRoot } from "@/utils/local-workspace";
import { getCloudSyncStatus } from "@/utils/todo/cloud-sync";
import { auth } from "@/utils/auth";
import prisma from "@/utils/prisma";
import { SafeError } from "@/utils/error";
export const GET = withAuth("todo/sync/recovery", async (request) => {
  const session = await auth(request.headers);
  const active =
    session?.session?.id &&
    (await prisma.session.findFirst({
      where: {
        id: session.session.id,
        userId: request.auth.userId,
        expires: { gt: new Date() },
      },
      select: { id: true },
    }));
  if (!active)
    throw new SafeError(
      "Sign in again before downloading a recovery key.",
      401,
    );
  const status = await getCloudSyncStatus(request.auth.userId);
  if (!status.enabled)
    throw new SafeError("No cloud backup is configured for this account.", 404);
  const recovery = await readFile(
    resolve(localWorkspaceRoot(), ".context/sync/recovery.json"),
    "utf8",
  );
  return new Response(recovery, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": 'attachment; filename="1a2o-recovery.json"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
