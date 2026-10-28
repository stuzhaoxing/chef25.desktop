import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export async function sha256(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

export function verifyManifest(manifest, lock, platform, arch, nodeHash) {
  if (
    manifest.sillyTavernCommit !== lock.commit ||
    manifest.archiveSha256 !== lock.sha256
  )
    throw new Error("SillyTavern runtime does not match runtime.lock.json");
  if (manifest.platform !== platform || manifest.arch !== arch)
    throw new Error(
      "Runtime architecture does not match this build host; prepare it on the target architecture",
    );
  if (manifest.nodeSha256 !== nodeHash)
    throw new Error("Bundled Node.js checksum mismatch");
}
