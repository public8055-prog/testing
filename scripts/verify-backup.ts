import {existsSync} from "node:fs";
import {verifyEncryptedBackup} from "../lib/backups";
import {closeMongo} from "../lib/mongo";
for(const file of[".env.production.local",".env.local",".env.production",".env"])if(existsSync(file))process.loadEnvFile(file);
async function main(){const file=process.argv[2];if(!file)throw new Error("Missing backup path.");console.log(JSON.stringify(await verifyEncryptedBackup(file)));}
main().catch(()=>{console.error("Backup verification failed. Check the encrypted file, protected key, and permissions to create an isolated verification database. Existing application databases were not overwritten.");process.exitCode=1;}).finally(closeMongo);
