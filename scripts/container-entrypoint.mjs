import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { MongoClient } from "mongodb";
import { childExitCode } from "./process-lifecycle.mjs";

/** Validate configuration without opening any database or network connection. */
export function validateContainerConfiguration(environment = process.env) {
  const key = Buffer.from(environment.AUTH_JWT_SECRET || "", "base64");
  if (key.length !== 32 || key.toString("base64") !== environment.AUTH_JWT_SECRET) {
    throw new Error("Container startup refused: configure AUTH_JWT_SECRET as a canonical base64-encoded 32-byte random key.");
  }
  try {
    const origin = new URL(environment.APP_URL || "");
    const preview = origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) && environment.COOKIE_SECURE === "false" && environment.PUBLIC_LAUNCH_READY !== "true";
    if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash || (!preview && (origin.protocol !== "https:" || environment.COOKIE_SECURE !== "true"))) throw new Error();
    if (!/^[a-zA-Z0-9_-]{1,63}$/.test(environment.MONGODB_DB || "")) throw new Error();
    const mongoUri = environment.MONGODB_URI || "", redis = new URL(environment.REDIS_URL || "");
    if (!/^mongodb(?:\+srv)?:\/\//.test(mongoUri) || !["redis:", "rediss:"].includes(redis.protocol) || !redis.hostname || redis.hash || redis.search || !/^\/(?:\d+)?$/.test(redis.pathname || "/")) throw new Error();
    // Parse with the actual driver, including multi-host replica-set URIs and
    // mongodb+srv's TLS default. Construction does not connect or resolve DNS.
    const mongo = new MongoClient(mongoUri).options;
    if (!preview) {
      if (environment.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new Error();
      const parameters = new URLSearchParams(mongoUri.includes("?") ? mongoUri.slice(mongoUri.indexOf("?") + 1) : "");
      for (const [name, value] of parameters) {
        const lower = name.toLowerCase();
        if (["tls", "ssl"].includes(lower) && value.toLowerCase() !== "true") throw new Error();
        if (lower === "rejectunauthorized" && value.toLowerCase() !== "true") throw new Error();
        if (["tlsinsecure", "tlsallowinvalidcertificates", "tlsallowinvalidhostnames", "tlsdisablecertificaterevocationcheck", "tlsdisableocspendpointcheck"].includes(lower) && value.toLowerCase() !== "false") throw new Error();
      }
      if (mongo.tls !== true || mongo.rejectUnauthorized === false || mongo.checkServerIdentity !== undefined || mongo.tlsInsecure === true
        || !mongo.credentials?.username || !mongo.credentials?.password) throw new Error();
      // An empty username selects Redis' default ACL user; a nonempty password
      // is still mandatory. Query flags are unsupported and rejected above.
      if (redis.protocol !== "rediss:" || !decodeURIComponent(redis.password)) throw new Error();
      decodeURIComponent(redis.username);
    }
  } catch {
    throw new Error("Container startup refused: configure a valid application origin, database name and MongoDB/Redis connections. Public deployments require HTTPS, secure cookies, authenticated TLS MongoDB and authenticated rediss with certificate verification enabled.");
  }
}

function main() {
  // Fail before starting either process. Never print configuration values.
  try { validateContainerConfiguration(); }
  catch (error) { console.error(error.message); process.exitCode = 1; return; }
  const command = process.argv.slice(2);
  if (!command.length) { console.error("Container startup refused: no process command supplied."); process.exitCode = 1; return; }
  const child = spawn(command[0], command.slice(1), { stdio: "inherit", shell: false });
  let stopping = false;
  for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => {
    if (stopping) return;
    stopping = true; child.kill(signal);
    const timeout = setTimeout(() => child.kill("SIGKILL"), 25000); timeout.unref();
  });
  child.on("error", () => { console.error("The container process could not start."); process.exitCode = 1; });
  child.on("exit", (code, signal) => { process.exitCode = childExitCode(code, signal, stopping); });
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
