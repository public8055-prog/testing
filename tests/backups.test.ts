import {strict as assert} from "node:assert";
import {test} from "node:test";
import {randomBytes,randomUUID} from "node:crypto";
import {readFile,writeFile,unlink,rmdir} from "node:fs/promises";
import path from "node:path";
import {BSON} from "mongodb";
import {mongoFixture} from "./helpers/mongo-fixture";
import {createEncryptedBackup,runScheduledBackup,verifyEncryptedBackup} from "../lib/backups";

test("encrypted snapshot preserves BSON data/indexes, rejects tampering, guards restore targets and respects the daily lease",async()=>{
 const fixture=await mongoFixture("backups"),directory=path.resolve(".data","backup-tests",randomUUID()),files:string[]=[];
 const saved={enabled:process.env.BACKUPS_ENABLED,key:process.env.BACKUP_ENCRYPTION_KEY,keyFile:process.env.BACKUP_KEY_FILE,directory:process.env.BACKUP_DIRECTORY};
 process.env.BACKUPS_ENABLED="false";delete process.env.BACKUP_KEY_FILE;process.env.BACKUP_ENCRYPTION_KEY=randomBytes(32).toString("base64");process.env.BACKUP_DIRECTORY=directory;
 try{
  assert.equal((await runScheduledBackup()).status,"disabled");
  const secret=`private-fixture-${randomUUID()}`;await fixture.db.collection("backup_bson_fixture").insertOne({_id:new BSON.ObjectId(),secret,when:new Date("2026-10-25T12:00:00Z"),integer:new BSON.Int32(7),double:new BSON.Double(7),large:BSON.Long.fromString("9007199254740993"),decimal:BSON.Decimal128.fromString("1.2300"),binary:new BSON.Binary(Buffer.from([1,2,3])),timestamp:new BSON.Timestamp({t:100,i:2})});await fixture.db.collection("backup_bson_fixture").createIndex({secret:1,when:-1},{name:"private_unique",unique:true});
  const result=await createEncryptedBackup();assert.equal(result.status,"created");if(result.status!=="created")throw new Error("Expected a newly created encrypted backup.");files.push(result.path);const encrypted=await readFile(result.path,"utf8");assert.equal(encrypted.includes(secret),false);assert.equal(encrypted.includes("backup_bson_fixture"),false);
  const verified=await verifyEncryptedBackup(result.path);assert.equal(verified.status,"verified");assert.equal(verified.sourceDatabase,fixture.db.databaseName);assert.equal(verified.documents,result.documents);assert.equal(verified.collections,result.collections);assert.equal(verified.verificationDatabaseRemoved,true);assert.match(verified.verificationDatabase,/^ukbv_[a-f0-9]{32}$/);assert.ok(verified.verificationDatabase.length<=38);assert.equal((await fixture.db.client.db(verified.verificationDatabase).listCollections().toArray()).length,0);
  assert.equal(await fixture.db.collection("backup_bson_fixture").countDocuments({secret}),1,"Verification does not alter the source database.");
  const tampered=JSON.parse(encrypted);tampered.ciphertext=(tampered.ciphertext[0]==="A"?"B":"A")+tampered.ciphertext.slice(1);const tamperedPath=path.join(directory,"tampered.ukbackup");await writeFile(tamperedPath,JSON.stringify(tampered),{flag:"wx",mode:0o600});files.push(tamperedPath);await assert.rejects(()=>verifyEncryptedBackup(tamperedPath));
  process.env.BACKUPS_ENABLED="true";assert.equal((await runScheduledBackup()).status,"already-completed");
  await fixture.db.collection<{_id:string;lease_token?:string;leased_until?:Date}>("backup_state").updateOne({_id:"encrypted-snapshot"},{$set:{lease_token:"another-worker",leased_until:new Date(Date.now()+60000)}});assert.equal((await createEncryptedBackup()).status,"busy");
 }finally{
  for(const file of files){assert.equal(path.dirname(path.resolve(file)),directory);await unlink(file).catch(()=>undefined);}await rmdir(directory).catch(()=>undefined);
  for(const[key,value]of Object.entries({BACKUPS_ENABLED:saved.enabled,BACKUP_ENCRYPTION_KEY:saved.key,BACKUP_KEY_FILE:saved.keyFile,BACKUP_DIRECTORY:saved.directory}))if(value===undefined)delete process.env[key];else process.env[key]=value;
  await fixture.close();
 }
});
