import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

test("source export accepts Redis default ACL syntax while blocking real passwords without logging them", async () => {
  const filename = `qa-export-${randomUUID()}.txt`, relative = path.join("tests", filename), password = randomBytes(24).toString("hex");
  const url = new URL("rediss://cache.example.test:6380"); url.username = "default"; url.password = password;
  const run = () => spawnSync(process.execPath, ["scripts/export-source.mjs"], { cwd: process.cwd(), env: { ...process.env, REDIS_URL: url.toString() }, encoding: "utf8", timeout: 30000 });
  await writeFile(relative, "The built-in Redis ACL username is default.\n", { flag: "wx" });
  try {
    const allowed = run(); assert.equal(allowed.status, 0, allowed.stderr);
    await writeFile(relative, `Synthetic secret: ${password}\n`, "utf8");
    const blocked = run(); assert.equal(blocked.status, 1); assert.match(blocked.stderr, /Export blocked/);
    assert.equal((blocked.stdout + blocked.stderr).includes(password), false);
    await writeFile(relative, Buffer.from(password, "utf16le"));
    const encoded = run(); assert.equal(encoded.status, 1); assert.equal((encoded.stdout + encoded.stderr).includes(password), false);
  } finally { assert.match(filename, /^qa-export-[a-f0-9-]+\.txt$/); await unlink(relative); }
});
