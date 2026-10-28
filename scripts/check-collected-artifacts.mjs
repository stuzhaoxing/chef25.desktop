import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { sha256 } from "./runtime-utils.mjs";
import { verifyUpdateSignature } from "./verify-update-signature.mjs";

const { version } = JSON.parse(await readFile("package.json", "utf8"));
const config = JSON.parse(await readFile("src-tauri/tauri.conf.json", "utf8"));
const id = process.platform === "darwin" ? "darwin-universal" : "win32-x64";
const folder = path.join("artifacts", id);
const names = await readdir(folder);
const signatures = names.filter((name) => name.endsWith(".sig"));
const checksums = names.filter((name) => name.endsWith(".sha256"));
if (signatures.length !== 1 || checksums.length !== 1)
  throw new Error("Expected one updater signature and one installer checksum");
for (const name of checksums) {
  const [digest, filename] = (await readFile(path.join(folder, name), "utf8"))
    .trim()
    .split("  ");
  if (filename !== path.basename(filename) || !names.includes(filename))
    throw new Error("Unexpected checksum filename");
  if ((await sha256(path.join(folder, filename))) !== digest)
    throw new Error("Collected installer checksum differs");
}
for (const name of signatures) {
  const file = path.join(folder, name.slice(0, -4));
  verifyUpdateSignature(
    await readFile(file),
    await readFile(file + ".sig", "utf8"),
    config.plugins.updater.pubkey,
    version,
  );
}
console.log(
  `Collected ${id} installer checksum, updater signature and signed version verified`,
);
