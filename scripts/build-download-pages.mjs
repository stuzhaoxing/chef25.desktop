import { mkdir, copyFile, writeFile, readdir } from "node:fs/promises";

const output = new URL("../artifacts/download-pages/", import.meta.url);
await mkdir(output, { recursive: true });
// Installers must only live in private R2, never in Pages static assets.
const allowed = new Set(["_worker.js", "_routes.json", "404.html"]);
for (const name of await readdir(output)) {
  if (!allowed.has(name)) throw new Error(`Unexpected Pages asset: ${name}`);
}
await copyFile(
  new URL("../deploy/download-worker.mjs", import.meta.url),
  new URL("_worker.js", output),
);
await writeFile(
  new URL("_routes.json", output),
  JSON.stringify({ version: 1, include: ["/*"], exclude: [] }) + "\n",
);
// A static fallback cannot expose packages, even if Functions are bypassed.
await writeFile(new URL("404.html", output), "Not found\n");
console.log("Pages gateway prepared (no installers or credentials).");
