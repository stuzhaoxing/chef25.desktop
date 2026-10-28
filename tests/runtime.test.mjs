import test from "node:test";
import assert from "node:assert/strict";
import { verifyManifest } from "../scripts/runtime-utils.mjs";

const lock = { commit: "fixed-commit", sha256: "archive-hash" };
const manifest = {
  sillyTavernCommit: lock.commit,
  archiveSha256: lock.sha256,
  platform: "darwin",
  arch: "arm64",
  nodeSha256: "node-hash",
};
test("accepts exactly the prepared target", () =>
  assert.doesNotThrow(() =>
    verifyManifest(manifest, lock, "darwin", "arm64", "node-hash"),
  ));
test("accepts a verified universal macOS runtime", () =>
  assert.doesNotThrow(() =>
    verifyManifest(
      { ...manifest, arch: "universal" },
      lock,
      "darwin",
      "universal",
      "node-hash",
    ),
  ));
test("rejects a single-architecture runtime in a universal distribution", () =>
  assert.throws(
    () => verifyManifest(manifest, lock, "darwin", "universal", "node-hash"),
    /architecture/,
  ));
test("rejects a runtime copied from another architecture", () =>
  assert.throws(
    () => verifyManifest(manifest, lock, "darwin", "x64", "node-hash"),
    /architecture/,
  ));
test("rejects a modified Node executable", () =>
  assert.throws(
    () => verifyManifest(manifest, lock, "darwin", "arm64", "modified"),
    /checksum/,
  ));
test("rejects a stale SillyTavern source", () =>
  assert.throws(
    () =>
      verifyManifest(
        { ...manifest, sillyTavernCommit: "old" },
        lock,
        "darwin",
        "arm64",
        "node-hash",
      ),
    /lock/,
  ));
