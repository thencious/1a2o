import "server-only";
import { createHash, createHmac } from "node:crypto";
import { getCloudSyncConnection } from "./cloud-sync";
import { SafeError } from "@/utils/error";

export async function getCloudDeviceConnection(
  userId: string,
  sessionId: string,
) {
  const config = await getCloudSyncConnection(userId);
  if (!config) return null;
  const id = deviceId(sessionId);
  const token = createHmac("sha256", config.token)
    .update(`onea2o-device:${sessionId}`)
    .digest("hex");
  const docs = ["tasks", "notes"].map((workspace) =>
    createHash("sha256")
      .update(`${config.namespace}:${workspace}`)
      .digest("hex"),
  );
  const response = await fetch(`${config.url}/v1/devices/${id}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token, docs }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw new SafeError(
      "Could not refresh this device's private cloud connection. Reconnect the device and try again.",
      503,
    );
  return {
    url: config.url,
    namespace: config.namespace,
    key: config.key,
    token,
    deviceId: id,
  };
}
export async function revokeCloudDevice(userId: string, sessionId: string) {
  const config = await getCloudSyncConnection(userId);
  if (!config) return;
  const response = await fetch(
    `${config.url}/v1/devices/${deviceId(sessionId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${config.token}` },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok)
    throw new SafeError(
      "Could not revoke this device's cloud connection. Try Disconnect again.",
      503,
    );
}
function deviceId(sessionId: string) {
  return createHash("sha256")
    .update(`onea2o-device:${sessionId}`)
    .digest("hex");
}
