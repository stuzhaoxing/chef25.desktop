import { execFileSync } from "node:child_process";

const ref = process.argv[2] || "HEAD";
if (!/^(HEAD|[a-f0-9]{40})$/.test(ref))
  throw new Error("Expected HEAD or a full commit hash");
const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
const names = git("ls-tree", "-rz", "--name-only", ref)
  .split("\0")
  .filter(Boolean);
const patterns = [
  ["private-key", /-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----/],
  [
    "access-token",
    /(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})/,
  ],
  ["personal-home", /\/Users\/(?!runner(?:\/|-)|Shared\/)[^\s/"']+\//],
  ["credential-url", /https?:\/\/[^\s/@]+:[^\s/@]+@/],
  [
    "literal-secret",
    /(?:password|api[_-]?key|token|secret)\s*[:=]\s*["'][A-Za-z0-9+/=_-]{16,}["']/i,
  ],
];
const findings = [];
for (const name of names) {
  if (
    /(^|\/)(\.env(?!\.example)|id_rsa|id_ed25519)(\.|$)|\.(pem|p12|pfx|key)$/.test(
      name,
    )
  )
    findings.push(`${name}: forbidden credential filename`);
  if (/\.(png|ico|icns)$/.test(name)) continue;
  const content = git("show", `${ref}:${name}`);
  for (const [category, expression] of patterns) {
    content.split("\n").forEach((line, index) => {
      if (expression.test(line))
        findings.push(`${name}:${index + 1}: ${category}`);
    });
  }
}
for (const record of git("log", "--format=%H%x09%ae%x09%ce", ref)
  .trim()
  .split("\n")) {
  const [commit, author, committer] = record.split("\t");
  if (
    ![author, committer].every(
      (email) =>
        email?.endsWith("@users.noreply.github.com") ||
        email === "noreply@github.com",
    )
  )
    findings.push(`${commit.slice(0, 12)}: use GitHub noreply commit identity`);
}
if (findings.length) {
  console.error(
    "Public source checks failed (values are intentionally redacted):\n" +
      findings.join("\n"),
  );
  process.exitCode = 1;
} else
  console.log(
    `Public source checks passed for ${names.length} files and reachable commit identities. This is a guardrail, not a proof against every possible secret format.`,
  );
