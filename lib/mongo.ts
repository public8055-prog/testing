import { MongoClient, type ClientSession, type Collection, type Db, type Document } from "mongodb";

type MongoState = { client?: MongoClient; connection?: Promise<MongoClient> };
const globalMongo = globalThis as typeof globalThis & { urbanKareMongo?: MongoState };
const state = (globalMongo.urbanKareMongo ??= {});

export function mongoDatabaseName() {
  const name = process.env.MONGODB_DB || "urbankare";
  if (!/^[a-zA-Z0-9_-]{1,63}$/.test(name)) throw new Error("Invalid MONGODB_DB name.");
  return name;
}

async function mongoClient() {
  if (!state.connection) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error("Configure MONGODB_URI. MongoDB must run as a replica set for transactional booking safety.");
    state.client = new MongoClient(uri, {
      maxPoolSize: Math.max(5, Math.min(100, Number(process.env.MONGODB_POOL_SIZE) || 20)),
      minPoolSize: 0, maxConnecting: 4, waitQueueTimeoutMS: 5000,
      serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000,
      retryReads: true, retryWrites: true,
    });
    state.connection = state.client.connect().catch(async (cause) => {
      await state.client?.close().catch(() => undefined);
      state.connection = undefined; state.client = undefined;
      throw new Error("MongoDB is unavailable. Check its connection and replica-set configuration.", { cause });
    });
  }
  return state.connection;
}

export async function getMongoDb(): Promise<Db> { return (await mongoClient()).db(mongoDatabaseName()); }
export async function mongoCollection<T extends Document = Document>(name: string): Promise<Collection<T & { _id: string }>> {
  return (await getMongoDb()).collection<T & { _id: string }>(name);
}

/** Never put network calls, parallel operations or irreversible side effects in this callback: the driver can retry it. */
export async function withMongoTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  const client = await mongoClient();
  const session = client.startSession();
  try {
    return await session.withTransaction(() => fn(session), {
      readConcern: { level: "snapshot" }, writeConcern: { w: "majority" },
      readPreference: "primary", maxCommitTimeMS: 10_000, timeoutMS: 30_000,
    });
  } finally { await session.endSession(); }
}

export async function mongoHealth() {
  const db = await getMongoDb();
  const hello = await db.admin().command({ hello: 1 });
  return { connected: true, transactions: Boolean(hello.setName || hello.msg === "isdbgrid") };
}
export async function closeMongo() {
  await state.client?.close(); state.client = undefined; state.connection = undefined;
}

/** Convert driver documents to plain transport objects; no ObjectId/Date leaks into React props. */
export function plainDocument<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
