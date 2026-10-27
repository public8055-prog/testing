import {createCipheriv,createDecipheriv,createHash,randomBytes,randomUUID} from "node:crypto";
import {mkdir,readFile,writeFile,rename,unlink,stat} from "node:fs/promises";
import path from "node:path";
import {BSON,type Db,type Document,type CreateIndexesOptions,type IndexSpecification,type CreateCollectionOptions} from "mongodb";
import {getMongoDb,withMongoTransaction} from "./mongo";

const FORMAT="urbankare-encrypted-mongodb",VERSION=1,AAD=Buffer.from(`${FORMAT}:${VERSION}`);
const VERIFY_PREFIX="urbankare_backup_verify_";
type Row=Document&{_id:string};
type CollectionSnapshot={name:string;options:Document;indexes:Document[];documents:Document[];sha256:string};
type Snapshot={format:string;version:number;sourceDatabase:string;createdAt:string;collections:CollectionSnapshot[]};
export type BackupResult={status:"created";path:string;collections:number;documents:number;bytes:number;sha256:string}|{status:"busy"|"already-completed"|"disabled"};
function limit(){const configured=Number(process.env.BACKUP_MAX_BYTES||104857600);if(!Number.isSafeInteger(configured)||configured<1048576||configured>536870912)throw new Error("BACKUP_MAX_BYTES must be between 1 MiB and 512 MiB.");return configured;}
function canonical(value:unknown):string{if(Array.isArray(value))return`[${value.map(canonical).join(",")}]`;if(value&&typeof value==="object")return`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical((value as Record<string,unknown>)[key])}`).join(",")}}`;return JSON.stringify(value);}
function ejson(value:unknown){return canonical(BSON.EJSON.serialize(value,{relaxed:false}));}
function digest(value:unknown){return createHash("sha256").update(ejson(value)).digest("hex");}
function documentDigest(documents:Document[]){return digest([...documents].sort((a,b)=>ejson(a._id).localeCompare(ejson(b._id))));}
function indexOptions(index:Document){const{name,key,v,ns,background,...options}=index;void v;void ns;void background;return{name,key,...options};}
function indexDigest(indexes:Document[]){return digest(indexes.map(indexOptions).map(({key,...options})=>({...options,keyEntries:Object.entries(key)})).sort((a,b)=>String(a.name).localeCompare(String(b.name))));}
function duplicate(error:unknown){return Boolean(error&&typeof error==="object"&&"code"in error&&error.code===11000);}

async function encryptionKey(){
 const inline=process.env.BACKUP_ENCRYPTION_KEY,file=process.env.BACKUP_KEY_FILE;
 if(Boolean(inline)===Boolean(file))throw new Error("Configure exactly one protected backup key source.");
 let encoded=inline||"";
 if(file){const info=await stat(file);if(!info.isFile()||info.size>512)throw new Error("Invalid backup key file.");if(process.platform!=="win32"&&(info.mode&0o077)!==0)throw new Error("Backup key file permissions must restrict access to its owner.");encoded=await readFile(file,"utf8");}
 encoded=encoded.trim();const key=Buffer.from(encoded,"base64");if(key.length!==32||key.toString("base64")!==encoded)throw new Error("Backup encryption requires a 32-byte base64 key.");return key;
}
async function collectionMetadata(db:Db){
 const rows=await db.listCollections({},{nameOnly:false}).toArray(),metadata:{name:string;options:Document;indexes:Document[]}[]=[];
 for(const row of rows.filter(r=>!r.name.startsWith("system.")).sort((a,b)=>a.name.localeCompare(b.name))){
  if(row.type!=="collection"||row.options?.timeseries)throw new Error("This snapshot utility supports ordinary application collections only.");
  metadata.push({name:row.name,options:row.options||{},indexes:await db.collection(row.name).listIndexes().toArray()});
 }
 return metadata;
}
async function snapshot(db:Db):Promise<Snapshot>{
 const before=await collectionMetadata(db),fingerprint=digest(before);
 const data=await withMongoTransaction(async session=>{
  const collections:CollectionSnapshot[]=[];let size=0;
  // One read-only snapshot transaction covers every collection. No filesystem or network delivery side effects occur here.
  for(const metadata of before){const documents:Document[]=[];const cursor=db.collection(metadata.name).find({},{session,promoteValues:false,promoteLongs:false,batchSize:250});try{for await(const document of cursor){size+=Buffer.byteLength(ejson(document));if(size>limit())throw new Error("Snapshot exceeds BACKUP_MAX_BYTES; use an operator-managed backup service for this dataset.");documents.push(document);}}finally{await cursor.close();}collections.push({...metadata,documents,sha256:documentDigest(documents)});}
  return{format:FORMAT,version:VERSION,sourceDatabase:db.databaseName,createdAt:new Date().toISOString(),collections};
 });
 // Index DDL cannot be listed in a transaction. Reject a snapshot if collection/index metadata changed around its data read.
 if(digest(await collectionMetadata(db))!==fingerprint)throw new Error("Collection or index metadata changed during the snapshot. Retry after schema changes finish.");return data;
}
async function lease(db:Db,daily:boolean):Promise<{owner:string;day:string}|{status:"busy"|"already-completed"}>{
 const states=db.collection<Row>("backup_state"),now=new Date(),day=now.toISOString().slice(0,10),owner=randomUUID();
 try{await states.updateOne({_id:"encrypted-snapshot"},{$setOnInsert:{last_completed_day:null,leased_until:new Date(0)}},{upsert:true});}catch(error){if(!duplicate(error))throw error;}
 const current=await states.findOne({_id:"encrypted-snapshot"});if(daily&&current?.last_completed_day===day)return{status:"already-completed"as const};
 const claimed=await states.findOneAndUpdate({_id:"encrypted-snapshot",leased_until:{$lte:now},...(daily?{last_completed_day:{$ne:day}}:{})},{$set:{lease_token:owner,leased_until:new Date(now.getTime()+30*60000),started_at:now}},{returnDocument:"after"});
 return claimed?{owner,day}:{status:"busy"as const};
}
export async function createEncryptedBackup({daily=false}:{daily?:boolean}={}):Promise<BackupResult>{
 const db=await getMongoDb(),key=await encryptionKey();let lock:Awaited<ReturnType<typeof lease>>;
 try{lock=await lease(db,daily);}catch(error){key.fill(0);throw error;}if("status"in lock){key.fill(0);return lock;}
 const states=db.collection<Row>("backup_state");let lost=false,tempPath:string|undefined;
 const heartbeat=setInterval(()=>{void states.updateOne({_id:"encrypted-snapshot",lease_token:lock.owner},{$set:{leased_until:new Date(Date.now()+30*60000)}}).then(result=>{if(!result.matchedCount)lost=true;}).catch(()=>{lost=true;});},60000);heartbeat.unref();
 try{
  const data=await snapshot(db),plaintext=Buffer.from(BSON.EJSON.stringify(data,{relaxed:false}));if(plaintext.length>limit())throw new Error("Snapshot exceeds BACKUP_MAX_BYTES.");
  const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key,iv);cipher.setAAD(AAD);const encrypted=Buffer.concat([cipher.update(plaintext),cipher.final()]);plaintext.fill(0);
  const envelope=Buffer.from(JSON.stringify({format:FORMAT,version:VERSION,algorithm:"aes-256-gcm",iv:iv.toString("base64"),tag:cipher.getAuthTag().toString("base64"),ciphertext:encrypted.toString("base64")}));
  const stillOwned=await states.findOne({_id:"encrypted-snapshot",lease_token:lock.owner,leased_until:{$gt:new Date()}});if(lost||!stillOwned)throw new Error("Backup lease was lost before writing the snapshot.");
  const directory=path.resolve(process.env.BACKUP_DIRECTORY||".data/backups/encrypted");await mkdir(directory,{recursive:true,mode:0o700});
  const filename=`mongodb-${db.databaseName}-${new Date().toISOString().replace(/[:.]/g,"-")}-${randomUUID()}.ukbackup`,destination=path.join(directory,filename);tempPath=`${destination}.tmp`;
  await writeFile(tempPath,envelope,{flag:"wx",mode:0o600});await rename(tempPath,destination);tempPath=undefined;
  const sha256=createHash("sha256").update(envelope).digest("hex"),documents=data.collections.reduce((sum,c)=>sum+c.documents.length,0);
  const recorded=await states.updateOne({_id:"encrypted-snapshot",lease_token:lock.owner},{$set:{last_completed_day:lock.day,last_completed_at:new Date(),last_file:filename,last_sha256:sha256,last_collection_count:data.collections.length,last_document_count:documents,leased_until:new Date(0)},$unset:{lease_token:"",last_error:""}});
  if(!recorded.matchedCount)throw new Error("Snapshot file was written, but the backup lease changed. Inspect the backup directory before retrying.");
  return{status:"created",path:destination,collections:data.collections.length,documents,bytes:envelope.length,sha256};
 }catch(error){await states.updateOne({_id:"encrypted-snapshot",lease_token:lock.owner},{$set:{leased_until:new Date(0),last_error:"Backup did not complete; inspect protected infrastructure configuration."},$unset:{lease_token:""}}).catch(()=>undefined);throw error;}
 finally{clearInterval(heartbeat);key.fill(0);if(tempPath)await unlink(tempPath).catch(()=>undefined);}
}
export async function runScheduledBackup():Promise<BackupResult>{if(process.env.BACKUPS_ENABLED!=="true")return{status:"disabled"};return createEncryptedBackup({daily:true});}

async function decryptSnapshot(file:string):Promise<Snapshot>{
 const info=await stat(file);if(!info.isFile()||info.size>Math.ceil(limit()*1.4)+4096)throw new Error("Invalid or oversized encrypted backup.");
 const envelope=JSON.parse(await readFile(file,"utf8"));if(envelope.format!==FORMAT||envelope.version!==VERSION||envelope.algorithm!=="aes-256-gcm"||typeof envelope.iv!=="string"||typeof envelope.tag!=="string"||typeof envelope.ciphertext!=="string")throw new Error("Unsupported encrypted backup format.");
 const key=await encryptionKey();let plaintext:Buffer|undefined;
 try{const iv=Buffer.from(envelope.iv,"base64"),tag=Buffer.from(envelope.tag,"base64");if(iv.length!==12||tag.length!==16)throw new Error("Invalid encrypted backup header.");const decipher=createDecipheriv("aes-256-gcm",key,iv);decipher.setAAD(AAD);decipher.setAuthTag(tag);plaintext=Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext,"base64")),decipher.final()]);if(plaintext.length>limit())throw new Error("Decrypted backup exceeds the configured size limit.");const data=BSON.EJSON.parse(plaintext.toString("utf8"),{relaxed:false})as Snapshot;
  if(data.format!==FORMAT||Number(data.version)!==VERSION||typeof data.sourceDatabase!=="string"||!Array.isArray(data.collections))throw new Error("Invalid snapshot manifest.");
  const names=new Set<string>();for(const collection of data.collections){if(typeof collection.name!=="string"||!collection.name||collection.name.startsWith("system.")||/[\0$]/.test(collection.name)||names.has(collection.name)||!Array.isArray(collection.documents)||!Array.isArray(collection.indexes)||collection.documents.some(doc=>!doc||typeof doc!=="object"||!("_id"in doc))||documentDigest(collection.documents)!==collection.sha256)throw new Error("Snapshot content verification failed.");names.add(collection.name);}
  return data;
 }finally{key.fill(0);plaintext?.fill(0);}
}
/** Restores only into a generated verification database. No existing database is overwritten. */
export async function verifyEncryptedBackup(file:string){
 const data=await decryptSnapshot(path.resolve(file)),connection=await getMongoDb(),name=`${VERIFY_PREFIX}${randomUUID().replaceAll("-","")}`,target=connection.client.db(name);
 if(name===connection.databaseName||name===data.sourceDatabase||!new RegExp(`^${VERIFY_PREFIX}[a-f0-9]{32}$`).test(name))throw new Error("Unsafe restore verification target.");
 if((await target.listCollections({},{nameOnly:true}).toArray()).length)throw new Error("Restore verification requires a new empty target.");
 let created=false;
 try{
  // The private marker prevents cleanup from ever selecting another database if restore fails.
  await target.createCollection("_restore_verification_owner");await target.collection("_restore_verification_owner").insertOne({owner:name});created=true;
  for(const collection of data.collections){
   if(collection.name==="_restore_verification_owner")throw new Error("Snapshot uses a reserved verification collection name.");
   await target.createCollection(collection.name,collection.options as CreateCollectionOptions);const restored=target.collection(collection.name);
   for(let index=0;index<collection.documents.length;index+=250)await restored.insertMany(collection.documents.slice(index,index+250),{ordered:true,bypassDocumentValidation:true});
   const rows=await restored.find({},{promoteValues:false,promoteLongs:false}).toArray();if(rows.length!==collection.documents.length||documentDigest(rows)!==collection.sha256)throw new Error("Restored document verification failed.");
   for(const index of collection.indexes){if(index.name==="_id_")continue;const{key,...options}=indexOptions(index);const directions=Object.fromEntries(Object.entries(key).map(([field,direction])=>[field,typeof direction==="string"?direction:Number(direction)]));await restored.createIndex(directions as IndexSpecification,options as CreateIndexesOptions);}
   if(indexDigest(await restored.listIndexes().toArray())!==indexDigest(collection.indexes))throw new Error("Restored index verification failed.");
  }
  return{status:"verified"as const,sourceDatabase:data.sourceDatabase,collections:data.collections.length,documents:data.collections.reduce((sum,c)=>sum+c.documents.length,0),verificationDatabase:name,verificationDatabaseRemoved:true};
 }finally{
  if(created){const marker=await target.collection("_restore_verification_owner").findOne({owner:name});if(!marker||!name.startsWith(VERIFY_PREFIX)||target.databaseName!==name)throw new Error("Verification cleanup safety check failed.");await target.dropDatabase();}
 }
}
