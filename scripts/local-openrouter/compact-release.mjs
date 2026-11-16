import { lstatSync, readdirSync, realpathSync, statSync, unlinkSync } from "node:fs";
import { resolve, sep } from "node:path";
import { activeReleaseDirectory, validateReleaseDirectory } from "./release-policy.mjs";
import { pathToFileURL } from "node:url";

export function compactRelease(root, directory) {
  validateReleaseDirectory(directory);
  const app = realpathSync(resolve(root, "apps/web"));
  const release = resolve(app, directory);
  if (!realpathSync(release).startsWith(app + sep)) throw new Error("Release escaped app directory");
  for (const name of ["BUILD_ID", "routes-manifest.json"]) statSync(resolve(release, name));
  let removedBytes = 0, removedFiles = 0, runtimeBytes = 0;
  const queue = [release];
  for (const folder of queue) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const file = resolve(folder, entry.name);
      if (!file.startsWith(release + sep)) throw new Error("Invalid release artifact path");
      const info = lstatSync(file);
      // External dependencies may be junctions; never follow or change them.
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) { queue.push(file); continue; }
      // next start consumes runtime manifests, not deployment file lists or debugger maps.
      if (entry.name.endsWith(".map") || entry.name.endsWith(".nft.json")) {
        unlinkSync(file); removedBytes += info.size; removedFiles++;
      } else runtimeBytes += info.size;
    }
  }
  return { removedBytes, removedFiles, runtimeBytes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(import.meta.dirname, "../..");
  console.log(JSON.stringify(compactRelease(root, activeReleaseDirectory(root))));
}
