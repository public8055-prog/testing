import {ensureLocalRuntime,loadRuntimeEnvironment} from "./local-runtime.mjs";
loadRuntimeEnvironment(process.env.NODE_ENV!=="production");
try{const result=await ensureLocalRuntime();if(!result.managed)console.log("Automatic local infrastructure is disabled or external data services are configured. No local containers were changed.");}
catch(error){console.error(error.message);process.exitCode=1;}
