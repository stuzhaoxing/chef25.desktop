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

const root = process.cwd();
const { version } = JSON.parse(await readFile("package.json", "utf8"));
if (!/^\d+\.\d+\.\d+$/.test(version))
  throw new Error(
    "Expected a stable numeric package version (channel is separately marked preview)",
  );
const output = path.join(root, "artifacts/distribution");
await mkdir(output, { recursive: true });
const platforms = {};
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
  source: {
    url: `/downloads/v${version}/${sourceName}`,
    sha256: await sha256(path.join(output, sourceName)),
    size: (await stat(path.join(output, sourceName))).size,
  },
};
await writeFile(
  path.join(output, "distribution.json"),
  JSON.stringify(release, null, 2) + "\n",
);
const sums = [];
for (const name of (await readdir(output)).sort())
  sums.push(`${await sha256(path.join(output, name))}  ${name}`);
await writeFile(path.join(output, "SHA256SUMS"), sums.join("\n") + "\n");
console.log(`Created complete preview distribution v${version}`);
