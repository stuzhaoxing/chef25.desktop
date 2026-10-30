import {
  readFile,
  readdir,
  mkdir,
  copyFile,
  writeFile,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { sha256 } from "./runtime-utils.mjs";
import { verifyUpdateSignature } from "./verify-update-signature.mjs";

const root = process.cwd();
const downloadOrigin = process.env.CHEF25_DOWNLOAD_ORIGIN;
if (
  !downloadOrigin ||
  !/^https:\/\/[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(downloadOrigin)
)
  throw new Error(
    "Set CHEF25_DOWNLOAD_ORIGIN to the HTTPS custom download origin (no path or trailing slash)",
  );
const { version } = JSON.parse(await readFile("package.json", "utf8"));
if (!/^\d+\.\d+\.\d+$/.test(version))
  throw new Error(
    "Expected a stable numeric package version (channel is separately marked preview)",
  );
const output = path.join(root, "artifacts/distribution");
await mkdir(output, { recursive: true });
if ((await readdir(output)).length)
  throw new Error(
    "Distribution directory must be empty; reuse the existing distribution for publication retries",
  );
const platforms = {};
const updates = {};
const config = JSON.parse(await readFile("src-tauri/tauri.conf.json", "utf8"));
for (const id of ["darwin-universal", "win32-x64"]) {
  const extension = id.startsWith("darwin") ? ".dmg" : ".exe";
  const name = `Chef25_${version}_${id}${extension}`;
  const source = path.join(root, "artifacts", id, name);
  const digest = await sha256(source);
  const checksum = (await readFile(source + ".sha256", "utf8")).split(/\s+/)[0];
  if (checksum !== digest)
    throw new Error(`Downloaded artifact checksum mismatch: ${id}`);
  await copyFile(source, path.join(output, name));
  platforms[id] = {
    url: `/downloads/v${version}/${name}`,
    sha256: digest,
    size: (await stat(source)).size,
    signing: id === "darwin-universal" ? "notarized" : "unsigned",
  };
  const updateName =
    id === "darwin-universal" ? `Chef25_${version}_${id}.app.tar.gz` : name;
  const updatePath = path.join(root, "artifacts", id, updateName);
  const signature = (await readFile(updatePath + ".sig", "utf8")).trim();
  verifyUpdateSignature(
    await readFile(updatePath),
    signature,
    config.plugins.updater.pubkey,
    version,
  );
  if (updateName !== name)
    await copyFile(updatePath, path.join(output, updateName));
  updates[id] = {
    url: `/downloads/v${version}/${updateName}`,
    sha256: await sha256(updatePath),
    size: (await stat(updatePath)).size,
    signature,
  };
}
const sourceName = `Chef25_${version}_source.tar.gz`;
const archive = spawnSync(
  "git",
  [
    "archive",
    "--format=tar.gz",
    `--output=${path.join(output, sourceName)}`,
    "HEAD",
  ],
  { stdio: "inherit" },
);
if (archive.status !== 0)
  throw new Error("Cannot create matching source archive");
const git = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
if (git.status !== 0) throw new Error("Cannot read build commit");
const release = {
  version,
  preview: true,
  commit: git.stdout.trim(),
  platforms,
  updates,
  source: {
    url: `/downloads/v${version}/${sourceName}`,
    sha256: await sha256(path.join(output, sourceName)),
    size: (await stat(path.join(output, sourceName))).size,
  },
};
const aliases = {
  "darwin-aarch64": "darwin-universal",
  "darwin-x86_64": "darwin-universal",
  "windows-x86_64": "win32-x64",
};
await writeFile(
  path.join(output, "updater.json"),
  JSON.stringify(
    {
      version,
      notes:
        "关闭窗口收起到系统托盘，停止酒馆后恢复默认窗口尺寸。macOS 更新包已签名并公证；升级保留角色、聊天和配置。",
      pub_date: new Date().toISOString(),
      platforms: Object.fromEntries(
        Object.entries(aliases).map(([target, id]) => [
          target,
          {
            url: downloadOrigin + updates[id].url,
            signature: updates[id].signature,
          },
        ]),
      ),
    },
    null,
    2,
  ) + "\n",
);
await writeFile(
  path.join(output, "distribution.json"),
  JSON.stringify(release, null, 2) + "\n",
);
const sums = [];
for (const name of (await readdir(output)).sort())
  sums.push(`${await sha256(path.join(output, name))}  ${name}`);
await writeFile(path.join(output, "SHA256SUMS"), sums.join("\n") + "\n");
console.log(`Created complete preview distribution v${version}`);
