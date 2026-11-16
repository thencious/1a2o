import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { compactRelease } from "./compact-release.mjs";

test("compact runtime preserves application code and manifests, removes only debug/deployment artifacts", () => {
  const root = mkdtempSync(resolve(tmpdir(), "zenro-package-"));
  const release = resolve(root, "apps/web/.next-releases/test");
  mkdirSync(resolve(release, "server/chunks"), { recursive: true });
  const files = { "BUILD_ID": "test", "routes-manifest.json": "{}", "server/chunks/app.js": "code", "server/chunks/app.js.map": "debug", "server/app.js.nft.json": "trace", "server/reference-manifest.json": "runtime" };
  try {
    for (const [name, text] of Object.entries(files)) writeFileSync(resolve(release, name), text);
    const result = compactRelease(root, ".next-releases/test");
    assert.equal(result.removedBytes, 10);
    assert.equal(result.removedFiles, 2);
    for (const name of Object.keys(files)) assert.equal(existsSync(resolve(release, name)), !name.endsWith(".map") && !name.endsWith(".nft.json"));
    assert.equal(compactRelease(root, ".next-releases/test").removedFiles, 0);
    assert.throws(() => compactRelease(root, "../../outside"));
  } finally {
    // Only this test's freshly created directory can be removed.
    assert.ok(root.startsWith(resolve(tmpdir()) + "\\") || root.startsWith(resolve(tmpdir()) + "/"));
    rmSync(root, { recursive: true, force: true });
  }
});
