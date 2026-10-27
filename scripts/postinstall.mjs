import {existsSync} from "node:fs";
import path from "node:path";
import {ensureLocalRuntime,installMayStartServices,loadRuntimeEnvironment,workspace} from "./local-runtime.mjs";
if(installMayStartServices()&&[".env.local",".env.development.local",".env"].some(name=>existsSync(path.join(workspace,name)))){
  loadRuntimeEnvironment(true);
  try{await ensureLocalRuntime();}
  catch(error){console.warn(`Dependencies installed. ${error.message}`);console.warn("Database setup will retry automatically on npm run dev or npm start.");}
}
