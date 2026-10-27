import {existsSync} from "node:fs";
import {createEncryptedBackup} from "../lib/backups";
import {closeMongo} from "../lib/mongo";
for(const file of[".env.production.local",".env.local",".env.production",".env"])if(existsSync(file))process.loadEnvFile(file);
createEncryptedBackup().then(result=>console.log(JSON.stringify(result))).catch(()=>{console.error("Encrypted backup failed. Check protected key configuration, MongoDB replica-set availability, free disk space and snapshot size. No key or document content was logged.");process.exitCode=1;}).finally(closeMongo);
