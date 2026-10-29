import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyUpdateSignature } from "./verify-update-signature.mjs";

const folder = path.resolve(process.argv[2]);
const release = JSON.parse(
  await readFile(path.join(folder, "distribution.json"), "utf8"),
);
const config = JSON.parse(
  await readFile(
    fileURLToPath(new URL("../src-tauri/tauri.conf.json", import.meta.url)),
    "utf8",
  ),
);
for (const item of Object.values(release.updates ?? {})) {
  verifyUpdateSignature(
    await readFile(path.join(folder, path.basename(item.url))),
    item.signature,
    config.plugins.updater.pubkey,
    release.version,
  );
}
console.log("Distribution update signatures verified");
