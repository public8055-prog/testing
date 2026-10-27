import { readdir, readFile, writeFile, rm, realpath } from "node:fs/promises";
import path from "node:path";

// Never package local customer records, environment secrets, or browser artifacts.
const workspace = await realpath(process.cwd());
const output = path.join(workspace, ".next");
const standalone = path.join(output, "standalone");
const sensitive = (file) => {
  const relative = path.relative(workspace, file).replaceAll("\\", "/");
  return relative === ".data" || relative.startsWith(".data/") || relative === "artifacts" || relative.startsWith("artifacts/") || /^\.env(?:\.|$)/.test(relative);
};
let removedReferences = 0;
async function cleanTraces(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory() && !["cache", "standalone", "dev", "static"].includes(entry.name)) await cleanTraces(file);
    if (!entry.isFile() || !entry.name.endsWith(".nft.json")) continue;
    const manifest = JSON.parse(await readFile(file, "utf8"));
    if (!Array.isArray(manifest.files)) continue;
    const filtered = manifest.files.filter((item) => !sensitive(path.resolve(directory, item)));
    removedReferences += manifest.files.length - filtered.length;
    if (filtered.length !== manifest.files.length) await writeFile(file, JSON.stringify({ ...manifest, files: filtered }));
  }
}
await cleanTraces(output);
let removedPaths = 0;
for (const entry of await readdir(standalone, { withFileTypes: true })) {
  if (![".data", "artifacts"].includes(entry.name) && !/^\.env(?:\.|$)/.test(entry.name)) continue;
  const target = path.resolve(standalone, entry.name);
  const resolvedTarget = await realpath(target);
  if (!resolvedTarget.startsWith(`${standalone}${path.sep}`)) throw new Error("Build cleanup target must stay inside the standalone output.");
  await rm(target, { recursive: true, force: true });
  removedPaths++;
}
console.log(`Build sanitized: removed ${removedReferences} local-data trace references and ${removedPaths} generated output paths.`);
