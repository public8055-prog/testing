import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { closeMongo, getMongoDb, mongoCollection, mongoDatabaseName } from "../lib/mongo";

// Run while application writes to the old database are stopped. Source is opened read-only.
const sourcePath = path.resolve(process.argv[2] || process.env.SQLITE_PATH || ".data/urbankare.sqlite");
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
async function main() {
  const target = await getMongoDb();
  const existing = await target.listCollections({}, { nameOnly: true }).toArray();
  for (const collection of existing) if (await target.collection(collection.name).estimatedDocumentCount()) throw new Error("Migration requires an empty target database. Choose a new MONGODB_DB; existing data will never be overwritten.");
  const directory = path.resolve(".data/backups"); mkdirSync(directory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(directory, `before-mongodb-${stamp}.sqlite`);
  const original = new DatabaseSync(sourcePath, { readOnly: true });
  try { original.exec(`VACUUM INTO '${backupPath.replaceAll("'", "''")}'`); } finally { original.close(); }
  const backup = new DatabaseSync(backupPath, { readOnly: true });
  const counts: Record<string, number> = {};
  const digests: Record<string, string> = {};
  try {
    const tables = backup.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[];
    for (const { name } of tables) {
      if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error("Unsupported source table name.");
      const primary = (backup.prepare(`PRAGMA table_info("${name}")`).all() as { name: string; pk: number }[]).filter(c => c.pk).sort((a, b) => a.pk - b.pk).map(c => c.name);
      if (!primary.length) throw new Error(`Table ${name} has no stable primary key.`);
      const rows = backup.prepare(`SELECT * FROM "${name}"`).all() as Record<string, unknown>[];
      const documents = rows.map(row => {
        const id = primary.length === 1 ? String(row[primary[0]]) : primary.map(key => String(row[key])).join(":");
        const doc: Record<string, unknown> & { _id: string } = { ...row, _id: id };
        if (["categories", "services", "professionals"].includes(name) && typeof doc.payload === "string") doc.payload = JSON.parse(doc.payload);
        return doc;
      });
      const collection = await mongoCollection(name);
      for (let i = 0; i < documents.length; i += 250) await collection.insertMany(documents.slice(i, i + 250), { ordered: true });
      const actual = await collection.find({}).toArray();
      if (actual.length !== documents.length) throw new Error(`Count mismatch for ${name}.`);
      const digest = (records: Record<string, unknown>[]) => createHash("sha256").update(canonical(records.sort((a, b) => String(a._id).localeCompare(String(b._id))))).digest("hex");
      if (digest(documents) !== digest(actual)) throw new Error(`Content mismatch for ${name}.`);
      counts[name] = documents.length; digests[name] = digest(documents);
    }
  } finally { backup.close(); }
  const report = { completedAt: new Date().toISOString(), targetDatabase: mongoDatabaseName(), sourceBackup: backupPath, backupSha256: createHash("sha256").update(readFileSync(backupPath)).digest("hex"), counts, digests };
  const reportPath = path.join(directory, `mongodb-migration-${stamp}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: "verified", targetDatabase: report.targetDatabase, backupPath, reportPath, collections: Object.keys(counts).length, documents: Object.values(counts).reduce((a, b) => a + b, 0) }));
}
main().catch(() => { console.error("Migration did not complete. Source and backup are preserved; inspect configuration and use a new empty target for a retry."); process.exitCode = 1; }).finally(closeMongo);
