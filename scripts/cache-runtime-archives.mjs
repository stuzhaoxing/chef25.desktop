import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { sha256 } from "./runtime-utils.mjs";

const lock = JSON.parse(await readFile("runtime.lock.json", "utf8"));
const destination = path.resolve("artifacts/runtime-archives");
await mkdir(destination, { recursive: true });
const archives = [
  {
    file: "sillytavern-source.tar.gz",
    url: lock.archiveUrl,
    sha256: lock.sha256,
  },
  ...Object.values(lock.node.archives).map((archive) => ({
    ...archive,
    url: `https://nodejs.org/dist/v${lock.node.version}/${archive.file}`,
  })),
];

// Fetch on a Linux runner, then transfer through GitHub's artifact service.
// Each build verifies these same pinned hashes again before extraction.
await Promise.all(
  archives.map(async (archive) => {
    const target = path.join(destination, archive.file);
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch(archive.url, {
          signal: AbortSignal.timeout(180_000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await writeFile(target, Buffer.from(await response.arrayBuffer()));
      } catch (error) {
        await rm(target, { force: true });
        if (attempt === 3) throw error;
        console.log(`Retrying ${archive.file} after download failure`);
        continue;
      }
      if ((await sha256(target)) !== archive.sha256) {
        await rm(target, { force: true });
        throw new Error(`Archive checksum mismatch: ${archive.file}`);
      }
      console.log(`Verified ${archive.file}`);
      return;
    }
  }),
);
