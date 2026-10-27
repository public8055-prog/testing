import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
const root = process.cwd(), findings = [];
const privateValues = [];
for (const name of [".env.local", ".env.production.local", ".env.production", ".env"]) {
  let input; try { input = await readFile(path.join(root, name), "utf8"); } catch { continue; }
  for (const line of input.split(/\r?\n/)) {
    const entry = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/); if (!entry || !/(?:SECRET|PASSWORD|ENCRYPTION_KEY|DELIVERY_TOKEN)$/.test(entry[1])) continue;
    const value = entry[2].replace(/^(["'])(.*)\1$/, "$2"); if (value.length >= 10) privateValues.push({ name: entry[1], value });
  }
}
const signatures = [
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["stripe-secret", /\bsk_(?:live|test)_[A-Za-z0-9]{24,}\b/],
  ["aws-access-key", /\bAKIA[0-9A-Z]{16}\b/],
  ["google-api-key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["credential-bearing-uri", /(?:mongodb(?:\+srv)?|rediss?):\/\/[^\s/]+:[^\s@/]{10,}@/],
];
async function scan(directory) {
  let entries; try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const file = path.join(directory, entry.name), relative = path.relative(root, file).replaceAll("\\", "/");
    if (entry.isDirectory()) { if (!["node_modules", ".git", ".data", "artifacts", ".next"].includes(entry.name)) await scan(file); continue; }
    if (!/\.(?:ts|tsx|js|mjs|json|md|ya?ml|html|css|svg|txt)$/.test(entry.name) || entry.name === "package-lock.json" || relative === "scripts/security-audit.mjs") continue;
    const content = await readFile(file, "utf8");
    for (const secret of privateValues) if (content.includes(secret.value)) findings.push({ kind: "configured-secret-in-source", file: relative, variable: secret.name });
    for (const [kind, pattern] of signatures) if (pattern.test(content)) findings.push({ kind, file: relative, scope: relative.startsWith("tests/") ? "test-fixture-review" : "source-review", note: "Candidate only; verify and rotate if real. Matched values are intentionally omitted." });
  }
}
await scan(root);
async function scanBrowserOutput(directory) {
  let entries; try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { await scanBrowserOutput(file); continue; }
    if (!/\.(?:js|json|html|txt|map|css)$/.test(entry.name)) continue;
    const content = await readFile(file, "utf8");
    for (const secret of privateValues) if (content.includes(secret.value)) findings.push({ kind: "configured-secret-in-browser-output", file: path.relative(root, file).replaceAll("\\", "/"), variable: secret.name });
  }
}
await scanBrowserOutput(path.join(root, ".next", "static"));
const environment = [];
for (const file of [".env.local", ".env.production.local", ".env.production", ".env"]) {
  let content; try { content = await readFile(path.join(root, file), "utf8"); } catch { continue; }
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/); if (!match) continue;
    const [, name, value] = match; environment.push({ file, name, configured: Boolean(value.trim()) });
    if (name.startsWith("NEXT_PUBLIC_") && /SECRET|PASSWORD|PRIVATE|MONGODB|REDIS|DATABASE|TOKEN/.test(name) && value.trim()) findings.push({ kind: "public-secret-variable", file, variable: name });
  }
}
const exposedCandidates = [];
async function publicFiles(directory) { let entries; try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; } for (const entry of entries) { const file = path.join(directory, entry.name); if (entry.isSymbolicLink()) continue; if (entry.isDirectory()) await publicFiles(file); else if (/^\.env|\.(?:sqlite|db|pem|key|log)$/i.test(entry.name)) exposedCandidates.push(path.relative(root, file)); } }
await publicFiles(path.join(root, "public")); await publicFiles(path.join(root, ".next", "static"));
let gitHistory;
try { gitHistory = { available: true, root: execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: root, stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }).trim(), audited: false, note: "Repository history requires a separate full-history scan; this command scans working sources only." }; }
catch { gitHistory = { available: false, audited: false, note: "No Git repository exists here or in its parent directories. Deleted/remote/historical secrets cannot be checked from this checkout." }; }
const report = { checkedAt: new Date().toISOString(), scope: "Local working-source and environment-name review; heuristic scan, not a penetration test or a guarantee", findings, exposedCandidates, environment, gitHistory };
await mkdir(path.join(root, "artifacts"), { recursive: true });
await writeFile(path.join(root, "artifacts", "security-audit.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ sourceCandidates: findings.length, exposedFileCandidates: exposedCandidates.length, environmentVariablesChecked: environment.length, gitHistoryAvailable: gitHistory.available, report: "artifacts/security-audit.json" }));
if (exposedCandidates.length || findings.some(finding => ["public-secret-variable", "configured-secret-in-source", "configured-secret-in-browser-output"].includes(finding.kind))) process.exitCode = 1;
