import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

export function desktopActivationPath(value) {
  if (typeof value !== "string") throw new Error("Invalid app destination");
  const target = new URL(value, "http://localhost:3000");
  if (
    target.origin !== "http://localhost:3000" ||
    target.username ||
    target.password ||
    !/^\/(?:[a-zA-Z0-9_-]+\/)?(?:mail|messages|todo|agents)$/.test(
      target.pathname,
    )
  )
    throw new Error("Invalid app destination");
  return target.pathname + target.search;
}
export function queueDesktopActivation(root, target, now = Date.now()) {
  const value = {
    id: randomUUID(),
    path: desktopActivationPath(target),
    createdAt: now,
  };
  atomic(root, "activation.json", value);
  return value;
}
export function readDesktopActivation(root, now = Date.now()) {
  const value = read(root, "activation.json");
  if (
    !value ||
    typeof value.id !== "string" ||
    !/^[0-9a-f-]{36}$/.test(value.id) ||
    !Number.isFinite(value.createdAt) ||
    value.createdAt > now + 5000 ||
    now - value.createdAt > 600_000
  )
    return null;
  let path;
  try {
    path = desktopActivationPath(value.path);
  } catch {
    return null;
  }
  if (read(root, "activation-ack.json")?.id === value.id) return null;
  return { id: value.id, path, createdAt: value.createdAt };
}
export function acknowledgeDesktopActivation(root, id, now = Date.now()) {
  const current = readDesktopActivation(root, now);
  if (current?.id !== id) return false;
  atomic(root, "activation-ack.json", { id, at: now });
  return true;
}
function read(root, name) {
  try {
    return JSON.parse(
      readFileSync(
        resolve(/* turbopackIgnore: true */ root, ".context/desktop", name),
        "utf8",
      ),
    );
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}
function atomic(root, name, value) {
  const directory = resolve(
    /* turbopackIgnore: true */ root,
    ".context/desktop",
  );
  mkdirSync(directory, { recursive: true });
  const file = resolve(directory, name),
    temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
  renameSync(temp, file);
}
