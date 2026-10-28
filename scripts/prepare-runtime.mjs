import {
  cp,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
  chmod,
  readdir,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { sha256 } from "./runtime-utils.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const lock = JSON.parse(
  await readFile(path.join(root, "runtime.lock.json"), "utf8"),
);
const requiredNode = (
  await readFile(path.join(root, ".node-version"), "utf8")
).trim();
if (process.versions.node !== requiredNode)
  throw new Error(
    `Use Node.js ${requiredNode} for a reproducible runtime (current: ${process.versions.node})`,
  );
if (lock.node.version !== requiredNode)
  throw new Error("Node archive lock and .node-version differ");
if (!["darwin", "win32"].includes(process.platform))
  throw new Error("Prepare desktop resources on macOS or Windows");
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run through npm run runtime:prepare");
// Git Bash's GNU tar interprets drive letters as remote archive hosts.
// Windows ships bsdtar, which accepts native paths and Node's ZIP archives.
if (process.platform === "win32" && !process.env.SystemRoot)
  throw new Error("SystemRoot is required to locate Windows tar.exe");
const tar =
  process.platform === "win32"
    ? path.join(process.env.SystemRoot, "System32", "tar.exe")
    : "tar";
const resources = path.join(root, "src-tauri/resources");
const staging = path.join(resources, `.runtime-${process.pid}`);
const destination = path.join(resources, "runtime");
await mkdir(staging, { recursive: true });

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${path.basename(command)} exited with ${result.status}`);
}

async function download(url, destination, expectedHash) {
  console.log(
    `Downloading verified runtime archive: ${path.basename(destination)}`,
  );
  if (process.platform === "darwin") {
    // Use the system TLS client and IPv4 on macOS runners, where Node's fetch
    // can stall on the distribution CDN. Retries never bypass the hash check.
    run(
      "/usr/bin/curl",
      [
        "--fail",
        "--location",
        "--silent",
        "--show-error",
        "--ipv4",
        "--proto",
        "=https",
        "--proto-redir",
        "=https",
        "--connect-timeout",
        "20",
        "--max-time",
        "180",
        "--retry",
        "2",
        "--retry-delay",
        "2",
        "--retry-all-errors",
        "--output",
        destination,
        url,
      ],
      root,
    );
  } else {
    const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
    if (!response.ok)
      throw new Error(`Download failed: HTTP ${response.status}`);
    await writeFile(destination, Buffer.from(await response.arrayBuffer()));
  }
  if ((await sha256(destination)) !== expectedHash)
    throw new Error("Archive checksum mismatch; refusing to extract");
}

async function ensurePortableDependencies(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (item.isDirectory())
      await ensurePortableDependencies(path.join(directory, item.name));
    else if (/\.(node|dylib|dll|so)$/.test(item.name))
      throw new Error(
        `Native dependency ${item.name} needs an explicit universal packaging strategy`,
      );
  }
}

try {
  console.log(
    `Preparing SillyTavern ${lock.version} (${lock.commit.slice(0, 12)}) for ${process.platform}/${process.arch}`,
  );
  const archive = path.join(staging, "sillytavern-source.tar.gz");
  const response = await fetch(lock.archiveUrl, {
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok)
    throw new Error(`Source download failed: HTTP ${response.status}`);
  await writeFile(archive, Buffer.from(await response.arrayBuffer()));
  if ((await sha256(archive)) !== lock.sha256)
    throw new Error("Source archive checksum mismatch; refusing to extract");
  const tavern = path.join(staging, "sillytavern");
  await mkdir(tavern);
  run(tar, ["-xzf", archive, "--strip-components=1", "-C", tavern], root);
  run(
    process.execPath,
    [npmCli, "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
    tavern,
  );
  // The pinned SillyTavern dependency graph is JS/WASM-only; reject native additions.
  await ensurePortableDependencies(path.join(tavern, "node_modules"));
  const nodeName = process.platform === "win32" ? "node.exe" : "node";
  const nodePath = path.join(staging, nodeName);
  const targets =
    process.platform === "darwin"
      ? ["darwin-arm64", "darwin-x64"]
      : ["win32-x64"];
  const nodeDirectories = [];
  for (const target of targets) {
    const artifact = lock.node.archives[target];
    const extracted = path.join(staging, `.node-${target}`);
    await mkdir(extracted);
    const archivePath = path.join(extracted, artifact.file);
    await download(
      `https://nodejs.org/dist/v${requiredNode}/${artifact.file}`,
      archivePath,
      artifact.sha256,
    );
    run(tar, ["-xf", archivePath, "-C", extracted], root);
    nodeDirectories.push(
      path.join(extracted, artifact.file.replace(/\.(tar\.gz|zip)$/, "")),
    );
  }
  await cp(
    path.join(nodeDirectories[0], "LICENSE"),
    path.join(staging, "NODE-LICENSE"),
  );
  if (process.platform === "darwin") {
    run(
      "lipo",
      [
        "-create",
        ...nodeDirectories.map((dir) => path.join(dir, "bin/node")),
        "-output",
        nodePath,
      ],
      root,
    );
    run("lipo", [nodePath, "-verify_arch", "arm64", "x86_64"], root);
    run("codesign", ["--force", "--sign", "-", nodePath], root);
    await chmod(nodePath, 0o755);
  } else {
    await cp(path.join(nodeDirectories[0], "node.exe"), nodePath);
  }
  for (const target of targets)
    await rm(path.join(staging, `.node-${target}`), { recursive: true });
  run(nodePath, ["--version"], root);
  await cp(path.join(root, "LICENSE"), path.join(staging, "CHEF25-LICENSE"));
  await cp(
    path.join(root, "THIRD_PARTY_NOTICES.md"),
    path.join(staging, "THIRD_PARTY_NOTICES.md"),
  );
  const manifest = {
    schemaVersion: 1,
    sillyTavernVersion: lock.version,
    sillyTavernCommit: lock.commit,
    archiveSha256: lock.sha256,
    nodeVersion: requiredNode,
    nodeSha256: await sha256(nodePath),
    platform: process.platform,
    arch: process.platform === "darwin" ? "universal" : "x64",
    nodeArchiveSha256: Object.fromEntries(
      targets.map((target) => [target, lock.node.archives[target].sha256]),
    ),
  };
  await writeFile(
    path.join(staging, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  // A failed download/install leaves the last complete runtime untouched.
  const previous = path.join(resources, `.runtime-previous-${process.pid}`);
  let moved = false;
  try {
    await rename(destination, previous);
    moved = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  try {
    await rename(staging, destination);
  } catch (error) {
    if (moved) await rename(previous, destination);
    throw error;
  }
  if (moved) await rm(previous, { recursive: true });
  console.log(
    "Runtime ready. Source archive and third-party licenses are included.",
  );
} finally {
  await rm(staging, { recursive: true, force: true });
}
