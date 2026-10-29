import { createWriteStream, constants } from "node:fs";
import { lstat, readdir, realpath, readFile, open, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Dependency-free POSIX ustar + gzip export. Run with the project's supported Node version.
// This is an allowlisted source snapshot, not a database, credentials or user-upload backup.
const root = fileURLToPath(new URL("../", import.meta.url));
const roots = ["app", "components", "lib", "hooks", "store", "scripts", "tests", "docs", "public", "config"];
const rootFiles = [
  "README.md", "AGENTS.md", "CLAUDE.md", "package.json", "package-lock.json", ".env.example", "vercel.json",
  ".gitignore", ".dockerignore", "Dockerfile", "docker-compose.yml", "docker-compose.infra.yml",
  "next.config.ts", "next.config.mjs", "next.config.js", "next-env.d.ts", "proxy.ts", "middleware.ts",
  "eslint.config.mjs", "postcss.config.mjs", "playwright.config.ts", "tsconfig.json", "components.json",
];
const excludedDirectories = new Set(["node_modules", "artifacts", "logs", "coverage", "test-results", "playwright-report", "uploads", ".vercel"]);
const excludedFiles = /(?:\.(?:log|tsbuildinfo|pem|key|p12|pfx|jks|keystore|sqlite(?:3)?|db|bak|backup|zip|tar|tgz|gz|7z)$|^(?:credentials|secrets)(?:\.|$))/i;
const archiveName = "urbankare-source.tar.gz", manifestName = "urbankare-source.manifest.json";
const maxFileBytes = 64 * 1024 * 1024;
const privatePatterns = new Map();
class ExportError extends Error {}
const stop = message => { throw new ExportError(message); };

function withinRoot(file) {
  const relative = path.relative(root, file);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
async function statOptional(file) {
  try { return await lstat(file); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
async function safeStat(file) {
  const stat = await lstat(file);
  if (stat.isSymbolicLink() || !withinRoot(await realpath(file))) stop("Export rejected a symbolic link or path outside the source directory.");
  return stat;
}
function addPrivateValue(value) {
  if (!value) return;
  const variants = new Set([value, JSON.stringify(value).slice(1, -1), encodeURIComponent(value)]);
  for (const variant of variants) for (const encoding of ["utf8", "utf16le"]) {
    const bytes = Buffer.from(variant, encoding);
    privatePatterns.set(bytes.toString("hex"), bytes);
  }
}
function scanPrivateValues(bytes,sourceName) {
  for (const value of privatePatterns.values()) if (bytes.includes(value)) stop(`Export blocked: a configured private credential occurs in ${sourceName||"an allowlisted filename or manifest"}. No credential value was logged.`);
}
function inspectUriPart(uri,part,username){
  let decoded;try{decoded=decodeURIComponent(part);}catch{stop("A credential-bearing environment URI contains invalid encoding. Correct it before source export.");}
  // Redis' built-in default ACL username is public protocol syntax. Passwords,
  // full connection strings and every non-default identity remain protected.
  if(username&&/^rediss?:\/\//i.test(uri)&&decoded==="default")return;
  addPrivateValue(part);addPrivateValue(decoded);
}
const credentialName = /(?:^|_)(?:SECRET|TOKEN|PASSWORD|PASSWD|PASS|PRIVATE_KEY|API_KEY|ACCESS_KEY|ENCRYPTION_KEY|KEY_SECRET|KEY_ID)$/i;
const administratorIdentifier = /^(?:ADMIN_BOOTSTRAP|SEED_ADMIN)_(?:ID|EMAIL)$/i;
function inspectEnvironment(values) {
  for (const [key, value] of Object.entries(values)) {
    if (!value) continue;
    if (credentialName.test(key) || administratorIdentifier.test(key)) addPrivateValue(value);
    if (/(?:URI|URL|DSN)$/i.test(key)) {
      // MongoDB seed lists are valid connection strings but not WHATWG URLs.
      // Inspect authority credentials independently of URL parsing, with no network access.
      const authority = value.match(/^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/?#]*)/)?.[1];
      if (authority?.includes("@")) {
        addPrivateValue(value);
        const userinfo = authority.slice(0, authority.lastIndexOf("@")), separator = userinfo.indexOf(":");
        const parts = separator < 0 ? [userinfo] : [userinfo.slice(0, separator), userinfo.slice(separator + 1)];
        for (const [index,part] of parts.entries()) inspectUriPart(value,part,index===0);
      }
      try {
        const url = new URL(value);
        if (url.username || url.password) {
          addPrivateValue(value);
          for (const [index,part] of [url.username, url.password].entries()) inspectUriPart(value,part,index===0);
        }
        for (const [name, parameter] of url.searchParams) if (credentialName.test(name)) addPrivateValue(parameter);
      } catch { /* Non-URL configuration is still checked by its credential variable name. */ }
    }
  }
}
async function collectPrivateValues() {
  // Read configuration only for comparison; never copy it into the archive or mutate process.env.
  const privateFiles = (await readdir(root)).filter(name => name.startsWith(".env") && name !== ".env.example").sort();
  for(const name of [".data/hosted-production.env",".data/production-settings.env",".data/development-settings.env",".data/local-before-hosted.env"]){if(await statOptional(path.join(root,name)))privateFiles.push(name);}
  const environments = [];
  for (const name of privateFiles) {
    const file = path.join(root, name), stat = await safeStat(file);
    if (!stat.isFile() || stat.size > 1024 * 1024) stop("A private environment file is not a supported regular text file.");
    environments.push(parseEnv(await readFile(file, "utf8")));
  }
  const combined = Object.assign({}, ...environments, process.env);
  for (const values of [...environments, process.env]) {
    inspectEnvironment(values);
    const expanded = {};
    for (const [key, input] of Object.entries(values)) {
      let value = input;
      for (let pass = 0; pass < 10; pass++) {
        const next = value.replace(/(?<!\\)\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g, (match, braced, plain) => combined[braced || plain] ?? match);
        if (next === value) break;
        value = next;
      }
      expanded[key] = value.replaceAll("\\$", "$");
    }
    inspectEnvironment(expanded);
  }
}
async function collectFiles() {
  const files = [];
  async function visit(relative, allowHidden = false) {
    const absolute = path.join(root, relative), stat = await safeStat(absolute), name = path.basename(relative);
    // The upload API contains authored source, not user-uploaded files. Keep
    // excluding every other uploads directory, including public/uploads.
    const uploadApi = relative.split(path.sep).join("/") === "app/api/uploads";
    if (!allowHidden && (name.startsWith(".") || name.toLowerCase().startsWith("env.") || excludedDirectories.has(name.toLowerCase()) && !uploadApi || excludedFiles.test(name))) return;
    if (stat.isDirectory()) {
      for (const child of (await readdir(absolute)).sort()) await visit(path.join(relative, child));
    } else if (stat.isFile()) {
      const portable = relative.split(path.sep).join("/");
      if (/[\x00-\x1f\x7f]/.test(portable)) stop("An allowlisted source filename contains unsupported control characters.");
      scanPrivateValues(Buffer.from(portable));
      files.push({ relative: portable, absolute });
    } else stop("Export rejected a non-regular source file.");
  }
  for (const directory of roots) if (await statOptional(path.join(root, directory))) await visit(directory);
  for (const file of rootFiles) if (await statOptional(path.join(root, file))) await visit(file, true);
  for (const required of ["package.json", "package-lock.json", "README.md", ".env.example", "app/api/uploads/route.ts", "app/api/uploads/[id]/route.ts"]) if (!files.some(file => file.relative === required)) stop("A required source-export file is missing.");
  return files.sort((a, b) => a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0);
}
async function readStableSource(file) {
  const before = await safeStat(file.absolute);
  if (!before.isFile() || before.size > maxFileBytes) stop("An allowlisted source file is not regular or exceeds the 64 MiB per-file export limit.");
  const handle = await open(file.absolute, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const opened = await handle.stat();
    if (opened.ino !== before.ino || opened.dev !== before.dev || opened.size !== before.size || opened.mtimeMs !== before.mtimeMs) stop("Source changed during export. Retry after edits finish.");
    const bytes = await handle.readFile(), after = await handle.stat();
    if (bytes.length !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) stop("Source changed during export. Retry after edits finish.");
    scanPrivateValues(bytes,file.relative);
    return { bytes, mode: before.mode & 0o111 ? 0o755 : 0o644 };
  } finally { await handle.close(); }
}
function tarHeader(filename, size, mode = 0o644) {
  const header = Buffer.alloc(512), bytes = value => Buffer.byteLength(value, "utf8");
  let name = filename, prefix = "";
  if (bytes(name) > 100) {
    const split = [...filename.matchAll(/\//g)].map(match => match.index).reverse().find(index => bytes(filename.slice(0, index)) <= 155 && bytes(filename.slice(index + 1)) <= 100);
    if (split === undefined) stop("A source path exceeds the portable ustar filename limit.");
    prefix = filename.slice(0, split); name = filename.slice(split + 1);
  }
  const octal = (value, offset, length) => {
    const encoded = value.toString(8).padStart(length - 1, "0");
    if (encoded.length >= length) stop("A source file exceeds portable archive limits.");
    header.write(`${encoded}\0`, offset, length, "ascii");
  };
  header.write(name, 0, 100, "utf8"); octal(mode, 100, 8); octal(0, 108, 8); octal(0, 116, 8);
  octal(size, 124, 12); octal(0, 136, 12); header.fill(32, 148, 156); header[156] = 48;
  header.write("ustar\0", 257, 6, "ascii"); header.write("00", 263, 2, "ascii"); header.write(prefix, 345, 155, "utf8");
  const checksum = header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0");
  header.write(`${checksum}\0 `, 148, 8, "ascii");
  return header;
}
function* tarFile(relative, bytes, mode) {
  yield tarHeader(`urbankare-source/${relative}`, bytes.length, mode); yield bytes;
  if (bytes.length % 512) yield Buffer.alloc(512 - bytes.length % 512);
}

async function main() {
  if (process.argv.length > 2) stop("Source export takes no arguments. Run npm run export:source.");
  await collectPrivateValues();
  const files = await collectFiles(), output = path.join(root, "artifacts");
  if (await statOptional(output)) { if (!(await safeStat(output)).isDirectory()) stop("The artifact destination is not a regular directory."); }
  else await mkdir(output);
  for (const name of [archiveName, manifestName]) { const file = path.join(output, name); if (await statOptional(file)) { if (!(await safeStat(file)).isFile()) stop("An export destination is not a regular file."); } }
  const suffix = randomUUID(), archiveTemp = path.join(output, `.source-${suffix}.tar.gz.partial`), manifestTemp = path.join(output, `.source-${suffix}.json.partial`);
  const manifest = { formatVersion: 1, createdAt: new Date().toISOString(), format: "POSIX ustar + gzip", allowlistedRoots: roots, credentialComparison: "Configured private environment credential values, including escaped forms; no values are recorded.", files: [] };
  const digest = createHash("sha256"); let sourceBytes = 0, archiveBytes = 0;
  async function* entries() {
    for (const file of files) {
      const { bytes, mode } = await readStableSource(file);
      manifest.files.push({ path: file.relative, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
      sourceBytes += bytes.length; yield* tarFile(file.relative, bytes, mode);
    }
    const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`); scanPrivateValues(bytes);
    yield* tarFile("SOURCE-MANIFEST.json", bytes, 0o644); yield Buffer.alloc(1024);
  }
  try {
    await pipeline(Readable.from(entries()), createGzip({ level: 6 }), new Transform({ transform(chunk, encoding, callback) { digest.update(chunk); archiveBytes += chunk.length; callback(null, chunk); } }), createWriteStream(archiveTemp, { flags: "wx", mode: 0o600 }));
    const sha256 = digest.digest("hex");
    await writeFile(manifestTemp, `${JSON.stringify({ ...manifest, archive: { filename: archiveName, bytes: archiveBytes, sha256 }, sourceFileCount: files.length, sourceBytes }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await rename(manifestTemp, path.join(output, manifestName)); await rename(archiveTemp, path.join(output, archiveName));
    console.log(JSON.stringify({ archive: `artifacts/${archiveName}`, manifest: `artifacts/${manifestName}`, sourceFiles: files.length, archiveEntries: files.length + 1, sourceBytes, archiveBytes, sha256 }));
  } finally {
    // Only this invocation's two exact temporary paths can be removed.
    await Promise.all([archiveTemp, manifestTemp].map(file => unlink(file).catch(error => { if (error.code !== "ENOENT") throw error; })));
  }
}
main().catch(error => {
  console.error(error instanceof ExportError ? error.message : "Source export failed before publishing a new archive. Check source permissions, file stability and available disk space; no configuration or file content was logged.");
  process.exitCode = 1;
});
