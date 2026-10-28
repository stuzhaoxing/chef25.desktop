import { readFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { sha256, verifyManifest } from "./runtime-utils.mjs";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const runtime = path.join(root, "src-tauri/resources/runtime");
const lock = JSON.parse(
  await readFile(path.join(root, "runtime.lock.json"), "utf8"),
);
const manifest = JSON.parse(
  await readFile(path.join(runtime, "manifest.json"), "utf8"),
);
const nodePath = path.join(
  runtime,
  process.platform === "win32" ? "node.exe" : "node",
);
verifyManifest(
  manifest,
  lock,
  process.platform,
  process.platform === "darwin" ? "universal" : "x64",
  await sha256(nodePath),
);
for (const [target, checksum] of Object.entries(
  manifest.nodeArchiveSha256 ?? {},
)) {
  if (lock.node.archives[target]?.sha256 !== checksum)
    throw new Error("Node archive provenance mismatch");
}
const expectedTargets =
  process.platform === "darwin"
    ? ["darwin-arm64", "darwin-x64"]
    : ["win32-x64"];
if (
  JSON.stringify(Object.keys(manifest.nodeArchiveSha256 ?? {}).sort()) !==
  JSON.stringify(expectedTargets.sort())
)
  throw new Error("Incomplete Node architecture inventory");
if (process.platform === "darwin") {
  const result = spawnSync(
    "lipo",
    [nodePath, "-verify_arch", "arm64", "x86_64"],
    { stdio: "inherit" },
  );
  if (result.status !== 0)
    throw new Error("Node runtime must contain both macOS architectures");
}
if (
  (await sha256(path.join(runtime, "sillytavern-source.tar.gz"))) !==
  lock.sha256
)
  throw new Error("Bundled source archive checksum mismatch");
for (const file of [
  "sillytavern/server.js",
  "sillytavern/node_modules",
  "sillytavern/LICENSE",
  "NODE-LICENSE",
  "CHEF25-LICENSE",
  "THIRD_PARTY_NOTICES.md",
])
  await access(path.join(runtime, file));
console.log(
  `Verified runtime: SillyTavern ${manifest.sillyTavernVersion}, Node ${manifest.nodeVersion}, ${manifest.platform}/${manifest.arch}`,
);
