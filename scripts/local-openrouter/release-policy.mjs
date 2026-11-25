import {existsSync,readFileSync} from "node:fs";
import {resolve} from "node:path";
import {createServer} from "node:net";

export function validateReleaseDirectory(directory) {
  if (directory !== ".next" && !/^\.next-releases\/[a-zA-Z0-9_-]+$/.test(directory)) throw new Error("Invalid local release directory");
  return directory;
}

export function activeReleaseDirectory(root) {
  const file=resolve(root,".context/active-web-build.json");
  return existsSync(file) ? validateReleaseDirectory(JSON.parse(readFileSync(file,"utf8")).directory) : ".next";
}

export async function switchRelease({previous,candidate,checkCandidate,stopWeb,writeActive,installAssets,restoreAssets,startWeb}) {
  validateReleaseDirectory(previous);validateReleaseDirectory(candidate);
  await checkCandidate(candidate);
  await stopWeb();
  try {
    await writeActive(candidate);
    await installAssets();
    await startWeb();
  } catch (error) {
    await stopWeb();
    await writeActive(previous);
    await restoreAssets();
    await startWeb();
    throw error;
  }
}

export async function availableProbePort() {
  const server=createServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const address=server.address();
  const port=address.port;
  await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  return port;
}
