import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseEnv } from "node:util";
const root = process.cwd(), findings = [];
const privateValues = [];
const environmentFiles=[".env.local", ".env.production.local", ".env.production", ".env", ".data/hosted-production.env", ".data/production-settings.env", ".data/development-settings.env", ".data/local-before-hosted.env"];
const remember=(name,value)=>{if(value.length>=10)for(const variant of new Set([value,JSON.stringify(value).slice(1,-1),encodeURIComponent(value)]))privateValues.push({name,value:variant});};
for (const name of environmentFiles) {
  let input; try { input = await readFile(path.join(root, name), "utf8"); } catch { continue; }
  for (const [key,value] of Object.entries(parseEnv(input))) {
    if (/(?:SECRET|PASSWORD|PASS|PASSWD|TOKEN|PRIVATE_KEY|API_KEY|ACCESS_KEY|ENCRYPTION_KEY)$/.test(key)||/^(?:SEED_ADMIN|ADMIN_BOOTSTRAP)_(?:ID|EMAIL)$/.test(key))remember(key,value);
    if(/(?:URI|URL|DSN)$/.test(key)){
      const authority=value.match(/^[a-z+]+:\/\/([^/?#]*)/i)?.[1];
      if(authority?.includes("@")){remember(key,value);const info=authority.slice(0,authority.lastIndexOf("@")),separator=info.indexOf(":");if(separator>=0){const password=info.slice(separator+1);remember(key,password);try{remember(key,decodeURIComponent(password));}catch{findings.push({kind:"invalid-private-uri-encoding",file:name,variable:key});}}}
    }
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
for (const file of environmentFiles) {
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
let gitHistory,repositoryDetected=false;
try {
  const options={cwd:root,stdio:["ignore","pipe","ignore"],encoding:"utf8",maxBuffer:64*1024*1024};
  const gitRoot=execFileSync("git",["rev-parse","--show-toplevel"],options).trim();
  repositoryDetected=true;
  const history=execFileSync("git",["log","--all","--format=commit:%H","--patch","--no-ext-diff","--no-color"],options);
  const matched=new Set();for(const secret of privateValues)if(history.includes(secret.value))matched.add(secret.name);
  for(const variable of matched)findings.push({kind:"configured-secret-in-git-history",variable});
  let commit="",file="";const candidates=new Map();
  for(const line of history.split("\n")){
    if(/^commit:[a-f0-9]{40,64}$/.test(line)){commit=line.slice(7);file="";continue;}
    if(line.startsWith("+++ b/")){file=line.slice(6);continue;}
    if(!line.startsWith("+")||line.startsWith("+++"))continue;
    for(const[kind,pattern]of signatures)if(pattern.test(line))candidates.set(`${commit}:${file}:${kind}`,{commit,file,kind,scope:file.startsWith("tests/")?"test-fixture-review":"history-review"});
  }
  gitHistory={available:true,root:gitRoot,audited:true,commitsScanned:Number(execFileSync("git",["rev-list","--all","--count"],options).trim()),configuredSecretMatches:matched.size,heuristicCandidates:[...candidates.values()],note:"All locally reachable refs scanned. Heuristic candidates need review; values and diff contents are omitted."};
}
catch { gitHistory = { available: repositoryDetected, audited: false, note: repositoryDetected?"The history scan did not finish. Inspect Git availability or the 64 MiB scan limit; no clean-history conclusion is available.":"No Git repository exists here or in its parent directories. Deleted/remote/historical secrets cannot be checked from this checkout." };if(repositoryDetected)findings.push({kind:"history-audit-incomplete"}); }
const report = { checkedAt: new Date().toISOString(), scope: "Local working-source and environment-name review; heuristic scan, not a penetration test or a guarantee", findings, exposedCandidates, environment, gitHistory };
await mkdir(path.join(root, "artifacts"), { recursive: true });
await writeFile(path.join(root, "artifacts", "security-audit.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ sourceCandidates: findings.length, exposedFileCandidates: exposedCandidates.length, environmentVariablesChecked: environment.length, gitHistoryAvailable: gitHistory.available, report: "artifacts/security-audit.json" }));
if (exposedCandidates.length || findings.some(finding => ["public-secret-variable", "configured-secret-in-source", "configured-secret-in-browser-output", "configured-secret-in-git-history", "invalid-private-uri-encoding", "history-audit-incomplete"].includes(finding.kind))) process.exitCode = 1;
