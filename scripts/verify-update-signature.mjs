import { createHash, createPublicKey, verify } from "node:crypto";

// Tauri's .sig and public-key strings wrap the standard Minisign text in base64.
// Framing follows minisign-verify; Ed25519 and BLAKE2b use Node's crypto provider.
export function verifyUpdateSignature(
  bytes,
  encodedSignature,
  encodedPublicKey,
  expectedVersion,
) {
  const keyLines = Buffer.from(encodedPublicKey.trim(), "base64")
    .toString("utf8")
    .trim()
    .split(/\r?\n/);
  const lines = Buffer.from(encodedSignature.trim(), "base64")
    .toString("utf8")
    .trim()
    .split(/\r?\n/);
  if (
    keyLines.length !== 2 ||
    lines.length !== 4 ||
    !lines[2].startsWith("trusted comment: ")
  )
    throw new Error("Invalid updater signature encoding");
  const key = Buffer.from(keyLines[1], "base64");
  const signature = Buffer.from(lines[1], "base64");
  const globalSignature = Buffer.from(lines[3], "base64");
  if (
    key.length !== 42 ||
    signature.length !== 74 ||
    globalSignature.length !== 64 ||
    !key.subarray(2, 10).equals(signature.subarray(2, 10)) ||
    key.subarray(0, 2).toString() !== "Ed" ||
    signature.subarray(0, 2).toString() !== "ED"
  )
    throw new Error("Unexpected updater signature key or algorithm");
  const publicKey = createPublicKey({
    key: Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      key.subarray(10),
    ]),
    format: "der",
    type: "spki",
  });
  const payloadHash = createHash("blake2b512").update(bytes).digest();
  const signedComment = Buffer.concat([
    signature.subarray(10),
    Buffer.from(lines[2].slice(17)),
  ]);
  if (
    !verify(null, payloadHash, publicKey, signature.subarray(10)) ||
    !verify(null, signedComment, publicKey, globalSignature)
  )
    throw new Error("Updater signature verification failed");
  if (
    expectedVersion &&
    !lines[2].slice(17).split("\t").includes(`version:${expectedVersion}`)
  )
    throw new Error("Updater signed version mismatch");
}
