import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { copyVerifiedArchive, sha256 } from "../scripts/runtime-utils.mjs";

test("archive transfer verifies bytes again before a build can use them", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "chef25-archive-test-"));
  try {
    const source = path.join(directory, "cached.tar.gz");
    const destination = path.join(directory, "staged.tar.gz");
    await writeFile(source, "locked upstream bytes");
    const digest = await sha256(source);
    await copyVerifiedArchive(source, destination, digest);
    assert.equal(await readFile(destination, "utf8"), "locked upstream bytes");
    await writeFile(source, "modified artifact bytes");
    await assert.rejects(
      copyVerifiedArchive(source, destination, digest),
      /checksum mismatch/,
    );
    await rm(source);
    await assert.rejects(copyVerifiedArchive(source, destination, digest), {
      code: "ENOENT",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
