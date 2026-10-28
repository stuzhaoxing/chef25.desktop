import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { verifyUpdateSignature } from "../scripts/verify-update-signature.mjs";

test("verifies real Tauri CLI signatures and rejects tampering or another signer", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "chef25-signature-test-"),
  );
  const cli = path.resolve("node_modules/@tauri-apps/cli/tauri.js");
  const run = (...args) =>
    execFileSync(process.execPath, [cli, "signer", ...args], {
      env: {
        ...process.env,
        TAURI_SIGNING_PRIVATE_KEY: undefined,
        TAURI_SIGNING_PRIVATE_KEY_PATH: path.join(directory, "key"),
        TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "fixture-only",
      },
      stdio: "pipe",
    });
  try {
    run(
      "generate",
      "--ci",
      "-p",
      "fixture-only",
      "-w",
      path.join(directory, "key"),
    );
    const artifact = path.join(directory, "update.bin");
    const bytes = Buffer.from("signed installer fixture");
    await writeFile(artifact, bytes);
    run("sign", "--app-version", "0.2.0", artifact);
    const signature = await readFile(artifact + ".sig", "utf8");
    const publicKey = await readFile(path.join(directory, "key.pub"), "utf8");
    verifyUpdateSignature(bytes, signature, publicKey, "0.2.0");
    assert.throws(
      () => verifyUpdateSignature(bytes, signature, publicKey, "0.3.0"),
      /version mismatch/,
    );
    assert.throws(
      () =>
        verifyUpdateSignature(
          Buffer.from("modified installer"),
          signature,
          publicKey,
        ),
      /verification failed/,
    );
    run(
      "generate",
      "--ci",
      "-p",
      "fixture-only",
      "-w",
      path.join(directory, "other"),
    );
    const otherKey = await readFile(path.join(directory, "other.pub"), "utf8");
    assert.throws(
      () => verifyUpdateSignature(bytes, signature, otherKey),
      /key or algorithm/,
    );
    assert.throws(
      () => verifyUpdateSignature(bytes, "invalid", publicKey),
      /encoding/,
    );
    const lines = Buffer.from(signature.trim(), "base64")
      .toString()
      .trim()
      .split("\n");
    lines[2] += " modified";
    const modifiedComment = Buffer.from(lines.join("\n")).toString("base64");
    assert.throws(
      () => verifyUpdateSignature(bytes, modifiedComment, publicKey),
      /verification failed/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
