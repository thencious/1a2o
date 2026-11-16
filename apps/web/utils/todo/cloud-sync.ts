import "server-only";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { localWorkspaceRoot } from "@/utils/local-workspace";
import { decryptToken } from "@/utils/encryption";
export async function getCloudSyncStatus(userId: string) {
  const root = localWorkspaceRoot();
  let config: { ownerId?: string } = {};
  try {
    config = JSON.parse(
      decryptToken(
        await readFile(resolve(root, ".context/sync/config.enc"), "utf8"),
      ) || "{}",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { enabled: false, localCopies: true, workspaces: {} };
    throw error;
  }
  if (config.ownerId !== userId)
    return { enabled: false, localCopies: true, workspaces: {} };
  let state: {
    at?: number;
    workspaces?: Record<
      string,
      { syncedAt?: number; pending?: boolean; error?: string }
    >;
  } = {};
  try {
    state = JSON.parse(
      await readFile(resolve(root, ".context/sync/status.json"), "utf8"),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return {
    enabled: true,
    localCopies: true,
    checkedAt: state.at,
    workspaces: state.workspaces || {},
    recoveryAvailable: true,
  };
}

export async function getCloudSyncConnection(userId: string) {
  try {
    const config = JSON.parse(
      decryptToken(
        await readFile(
          resolve(localWorkspaceRoot(), ".context/sync/config.enc"),
          "utf8",
        ),
      ) || "{}",
    );
    if (config.ownerId !== userId) return null;
    return {
      url: config.url,
      namespace: config.namespace,
      key: config.key,
      token: config.token,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
