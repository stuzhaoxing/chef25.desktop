import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sha256 } from "../scripts/runtime-utils.mjs";
import { verifyUpdateSignature } from "../scripts/verify-update-signature.mjs";

test("distribution points signed updates at R2 and preserves existing retry artifacts", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "chef25-distribution-test-"),
  );
  const cli = path.resolve("node_modules/@tauri-apps/cli/tauri.js");
  const script = path.resolve("scripts/create-distribution.mjs");
  const env = {
    ...process.env,
    CHEF25_DOWNLOAD_ORIGIN: "https://download.chef25.com",
    TAURI_SIGNING_PRIVATE_KEY: undefined,
    TAURI_SIGNING_PRIVATE_KEY_PATH: path.join(directory, "fixture-key"),
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "fixture-only",
  };
  const sign = (...args) =>
    execFileSync(process.execPath, [cli, "signer", ...args], {
      env,
      stdio: "pipe",
    });
  try {
    sign(
      "generate",
      "--ci",
      "-p",
      "fixture-only",
      "-w",
      env.TAURI_SIGNING_PRIVATE_KEY_PATH,
    );
    const pubkey = await readFile(
      env.TAURI_SIGNING_PRIVATE_KEY_PATH + ".pub",
      "utf8",
    );
    await mkdir(path.join(directory, "src-tauri"));
    await writeFile(
      path.join(directory, "src-tauri/tauri.conf.json"),
      JSON.stringify({ plugins: { updater: { pubkey } } }),
    );
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ version: "0.2.1" }),
    );
    const git = (...args) =>
      execFileSync("git", args, { cwd: directory, stdio: "pipe" });
    git("init");
    git("add", "package.json", "src-tauri/tauri.conf.json");
    git(
      "-c",
      "user.name=Chef25 CI",
      "-c",
      "user.email=ci@users.noreply.github.com",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "fixture",
    );
    for (const [id, suffix] of [
      ["darwin-universal", ".dmg"],
      ["win32-x64", ".exe"],
    ]) {
      const folder = path.join(directory, "artifacts", id);
      await mkdir(folder, { recursive: true });
      const installer = path.join(folder, `Chef25_0.2.1_${id}${suffix}`);
      await writeFile(installer, "installer fixture " + id);
      await writeFile(installer + ".sha256", await sha256(installer));
      const update =
        id === "darwin-universal"
          ? path.join(folder, `Chef25_0.2.1_${id}.app.tar.gz`)
          : installer;
      if (update !== installer) await writeFile(update, "update fixture");
      sign("sign", "--app-version", "0.2.1", update);
    }
    execFileSync(process.execPath, [script], {
      cwd: directory,
      env,
      stdio: "pipe",
    });
    const output = path.join(directory, "artifacts/distribution");
    const release = JSON.parse(
      await readFile(path.join(output, "distribution.json"), "utf8"),
    );
    const updater = JSON.parse(
      await readFile(path.join(output, "updater.json"), "utf8"),
    );
    assert.equal(
      updater.platforms["darwin-aarch64"].url,
      updater.platforms["darwin-x86_64"].url,
    );
    assert.equal(Object.keys(release.platforms).length, 2);
    for (const item of Object.values(updater.platforms)) {
      assert.ok(
        item.url.startsWith(env.CHEF25_DOWNLOAD_ORIGIN + "/downloads/v0.2.1/"),
      );
      verifyUpdateSignature(
        await readFile(path.join(output, path.basename(item.url))),
        item.signature,
        pubkey,
        "0.2.1",
      );
    }
    const sums = await readFile(path.join(output, "SHA256SUMS"), "utf8");
    for (const line of sums.trim().split("\n")) {
      const [checksum, filename] = line.split("  ");
      assert.equal(await sha256(path.join(output, filename)), checksum);
    }
    const retry = spawnSync(process.execPath, [script], {
      cwd: directory,
      env,
      encoding: "utf8",
    });
    assert.notEqual(retry.status, 0);
    assert.match(retry.stderr, /reuse the existing distribution/);
    assert.equal(await readFile(path.join(output, "SHA256SUMS"), "utf8"), sums);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
