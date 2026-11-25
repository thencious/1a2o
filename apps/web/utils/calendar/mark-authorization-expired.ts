import prisma from "@/utils/prisma";
import type { Logger } from "@/utils/logger";

export async function markCalendarAuthorizationExpired({
  emailAccountId,
  connectionId,
  provider,
  accessToken,
  refreshToken,
  logger,
}: {
  emailAccountId: string;
  connectionId?: string | null;
  provider: string;
  accessToken?: string | null;
  refreshToken: string | null;
  logger: Logger;
}) {
  try {
    const connections = await prisma.calendarConnection.findMany({
      where: {
        emailAccountId,
        provider,
        ...(connectionId ? { id: connectionId } : {}),
        isConnected: true,
      },
      select: {
        id: true,
        accessToken: true,
        refreshToken: true,
        updatedAt: true,
      },
    });
    for (const connection of connections) {
      // Compare decoded credentials and guard the write against a newer login.
      if (
        connection.refreshToken !== refreshToken ||
        connection.accessToken !== (accessToken ?? null)
      )
        continue;
      await prisma.calendarConnection.updateMany({
        where: {
          id: connection.id,
          updatedAt: connection.updatedAt,
          isConnected: true,
        },
        data: { isConnected: false },
      });
    }
  } catch (error) {
    logger.error("Failed to record expired calendar authorization", { error });
  }
}
