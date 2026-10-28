import {
  readFile,
  readdir,
  mkdir,
  copyFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "./runtime-utils.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const bundleType = process.platform === "win32" ? "nsis" : "dmg";
const extension = process.platform === "win32" ? ".exe" : ".dmg";
const directory = path.join(
  root,
  process.platform === "darwin"
    ? "src-tauri/target/universal-apple-darwin/release/bundle"
    : "src-tauri/target/release/bundle",
  bundleType,
);
const files = (await readdir(directory)).filter((name) =>
  name.endsWith(extension),
);
if (files.length !== 1)
  throw new Error(`Expected exactly one ${extension} installer`);
const id = process.platform === "darwin" ? "darwin-universal" : "win32-x64";
const name = `Chef25_${pkg.version}_${id}${extension}`;
const destination = path.join(root, "artifacts", id);
await mkdir(destination, { recursive: true });
await copyFile(path.join(directory, files[0]), path.join(destination, name));
await writeFile(
  path.join(destination, name + ".sha256"),
  `${await sha256(path.join(destination, name))}  ${name}\n`,
);
const updaterSource =
  process.platform === "darwin"
    ? path.join(
        root,
        "src-tauri/target/universal-apple-darwin/release/bundle/macos/25小厨.app.tar.gz",
      )
    : path.join(directory, files[0]);
if (process.platform === "darwin") {
  const signing = JSON.parse(
    await readFile(
      path.join(path.dirname(updaterSource), "signing-status.json"),
      "utf8",
    ),
  );
  if (signing.version !== pkg.version || signing.macos !== "notarized")
    throw new Error("macOS notarization gate did not pass");
  const updaterName = `Chef25_${pkg.version}_${id}.app.tar.gz`;
  await copyFile(updaterSource, path.join(destination, updaterName));
  await copyFile(
    updaterSource + ".sig",
    path.join(destination, updaterName + ".sig"),
  );
} else {
  await copyFile(updaterSource + ".sig", path.join(destination, name + ".sig"));
}
console.log(`Collected ${name}`);
