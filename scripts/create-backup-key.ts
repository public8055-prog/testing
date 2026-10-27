import {randomBytes} from "node:crypto";
import {existsSync} from "node:fs";
import {mkdir,writeFile,unlink} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import path from "node:path";
for(const file of[".env.production.local",".env.local",".env.production",".env"])if(existsSync(file))process.loadEnvFile(file);
async function main(){
 if(!process.env.BACKUP_KEY_FILE)throw new Error("Set BACKUP_KEY_FILE to a protected destination.");
 const destination=path.resolve(process.env.BACKUP_KEY_FILE);await mkdir(path.dirname(destination),{recursive:true,mode:0o700});let created=false;const bytes=randomBytes(32);
 try{await writeFile(destination,`${bytes.toString("base64")}\n`,{flag:"wx",mode:0o600});created=true;
  if(process.platform==="win32"){const identity=execFileSync("whoami",["/user","/fo","csv","/nh"],{encoding:"utf8",windowsHide:true}),sid=identity.match(/S-\d(?:-\d+)+/)?.[0];if(!sid)throw new Error("Cannot resolve the current Windows identity.");execFileSync("icacls",[destination,"/inheritance:r","/grant:r",`*${sid}:F`],{stdio:"pipe",windowsHide:true});}
  console.log("Backup key file created with owner-only access. Store a separate protected recovery copy; the key value was not printed.");
 }catch(error){if(created)await unlink(destination).catch(()=>undefined);throw error;}finally{bytes.fill(0);}
}
main().catch(()=>{console.error("Backup key creation failed. Verify the protected destination is new and its permissions can be secured. No key value was logged.");process.exitCode=1;});
