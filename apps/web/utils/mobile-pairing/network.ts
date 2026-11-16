import "server-only";
import { networkInterfaces } from "node:os";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { localWorkspaceRoot } from "@/utils/local-workspace";
import { SafeError } from "@/utils/error";

export function privateAddresses() {
  return Object.values(networkInterfaces()).flatMap((values) =>
    (values ?? [])
      .filter(
        (value) =>
          value.family === "IPv4" &&
          !value.internal &&
          /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.)/.test(
            value.address,
          ),
      )
      .map((value) => `http://${value.address}:3012`),
  );
}
export async function enableMobileNetwork() {
  const root = localWorkspaceRoot();
  const data = resolve(root, ".context/mobile");
  await mkdir(data, { recursive: true });
  await writeFile(
    resolve(data, "network.json"),
    JSON.stringify({ enabled: true }),
  );
  const healthy = () =>
    fetch("http://127.0.0.1:3012/api/mobile/pair/status", {
      signal: AbortSignal.timeout(1000),
    })
      .then((response) => response.ok)
      .catch(() => false);
  if (await healthy()) return;
  const child = spawn(
    /* turbopackIgnore: true */ process.execPath,
    [resolve(root, "scripts/mobile/network-proxy.mjs")],
    {
      cwd: root,
      env: process.env,
      windowsHide: true,
      detached: true,
      stdio: "ignore",
    },
  );
  child.on("error", () => {});
  child.unref();
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (await healthy()) return;
  }
  throw new SafeError(
    "Could not enable the mobile connection. Check that port 3012 is available.",
  );
}
