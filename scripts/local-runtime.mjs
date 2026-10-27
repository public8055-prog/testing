import {spawn} from "node:child_process";
import {existsSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {setTimeout as delay} from "node:timers/promises";
import {MongoClient} from "mongodb";
import {createClient} from "redis";
import nextEnvironment from "@next/env";

export const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
export function loadRuntimeEnvironment(development=false){nextEnvironment.loadEnvConfig(workspace,development,console,true);}
export function developmentArguments(args,platform=process.platform){
  return platform==="win32"&&!args.some(arg=>["--webpack","--turbopack","--turbo","--help","-h"].includes(arg))?[...args,"--webpack"]:args;
}

/** Only the exact private Compose endpoints belong to this launcher. */
/** @param {Record<string,string|undefined>} [environment] */
export function usesManagedLocalData(environment=process.env){
  try{
    const mongo=new URL(environment.MONGODB_URI||""),redis=new URL(environment.REDIS_URL||"");
    return mongo.protocol==="mongodb:"&&["localhost","127.0.0.1"].includes(mongo.hostname)&&mongo.port==="27018"
      &&!mongo.username&&!mongo.password&&redis.protocol==="redis:"&&["localhost","127.0.0.1"].includes(redis.hostname)&&redis.port==="6380"&&!redis.username&&!redis.password;
  }catch{return false;}
}
/** @param {Record<string,string|undefined>} [environment] */
export function installMayStartServices(environment=process.env){
  return !environment.CI&&!environment.DOCKER_BUILD&&environment.NODE_ENV!=="production"&&environment.AUTO_START_LOCAL_INFRA!=="false";
}
function dockerExecutable(){
  if(process.platform!=="win32")return "docker";
  // An installer can update PATH after this terminal was opened.
  const folders=(process.env.PATH||"").split(path.delimiter);
  const candidates=[...folders.map(folder=>path.join(folder.replace(/^"|"$/g,""),"docker.exe")),
    path.join(process.env.LOCALAPPDATA||"","Programs","DockerDesktop","resources","bin","docker.exe"),
    path.join(process.env.ProgramFiles||"C:\\Program Files","Docker","Docker","resources","bin","docker.exe")];
  return candidates.find(file=>existsSync(file))||"docker";
}
export async function command(file,args,{timeout=30000,inherit=false,env=process.env,maxOutputBytes=16384}={}){
  return new Promise(resolve=>{
    const child=spawn(file==="docker"?dockerExecutable():file,args,{cwd:workspace,env,windowsHide:true,stdio:inherit?"inherit":["ignore","pipe","pipe"]});
    let output="",finished=false;
    if(!inherit){for(const stream of [child.stdout,child.stderr])stream.on("data",chunk=>{output=(output+chunk.toString()).slice(-maxOutputBytes);});}
    const timer=setTimeout(()=>{child.kill();finish(124);},timeout);
    function finish(code){if(finished)return;finished=true;clearTimeout(timer);resolve({code,output});}
    child.on("error",()=>finish(127));child.on("close",code=>finish(code??1));
  });
}
/** @param {Record<string,string|undefined>} [environment] */
export async function dataReady(environment=process.env){
  const mongo=new MongoClient(environment.MONGODB_URI||"mongodb://127.0.0.1:27018/?directConnection=true",{serverSelectionTimeoutMS:2000,connectTimeoutMS:2000,maxPoolSize:1});
  const redis=createClient({url:environment.REDIS_URL||"redis://127.0.0.1:6380",socket:{connectTimeout:2000,reconnectStrategy:false}});redis.on("error",()=>{});
  try{
    await mongo.connect();const hello=await mongo.db("admin").command({hello:1},{timeoutMS:2500});
    if(!hello.isWritablePrimary||!(hello.setName||hello.msg==="isdbgrid"))return false;
    await redis.connect();return await redis.ping()==="PONG";
  }catch{return false;}
  finally{await mongo.close().catch(()=>{});if(redis.isOpen)redis.destroy();}
}
/** @param {{initialize?:boolean,run?:typeof command,ready?:(environment:Record<string,string|undefined>)=>Promise<boolean>,sleep?:(milliseconds:number)=>Promise<unknown>,environment?:Record<string,string|undefined>}} [options] */
export async function ensureLocalRuntime({initialize=true,run=command,ready=dataReady,sleep=delay,environment=process.env}={}){
  if(environment.AUTO_START_LOCAL_INFRA==="false"||!usesManagedLocalData(environment))return {managed:false};
  if(!await ready(environment)){
    console.log("Checking local MongoDB and Redis…");
    const docker=await run("docker",["--version"]);if(docker.code!==0)throw new Error("Docker Desktop is required for local MongoDB/Redis. Install it with the Linux/WSL2 engine, then run npm run dev again.");
    if((await run("docker",["info","--format","{{.ServerVersion}}"],{timeout:5000})).code!==0){
      console.log("Starting Docker Desktop's Linux engine. First startup can take a few minutes…");
      const desktop=await run("docker",["desktop","start","--detach"],{timeout:15000});
      if(desktop.code!==0)throw new Error("Docker Desktop could not start automatically. Open Docker Desktop, finish any first-run/WSL setup, select Linux containers, then retry npm run dev. Your database volumes are preserved.");
      let running=false;
      for(let attempt=0;attempt<60;attempt++){
        const probe=await run("docker",["info","--format","{{.ServerVersion}}"],{timeout:3000});
        if(probe.code===0){running=true;break;}
        if(probe.code===127)throw new Error("The Docker executable is no longer available. Complete or repair the Docker Desktop installation, open its Linux engine, then retry npm run dev.");
        await sleep(2000);
      }
      if(!running)throw new Error("Docker Desktop did not become ready. Open it and resolve its WSL/Linux engine message, then retry npm run dev.");
    }
    console.log("Starting this project's MongoDB replica set and Redis (existing volumes are retained)…");
    const compose=await run("docker",["compose","-p","urbankare-infra","-f","docker-compose.infra.yml","up","-d","--wait","--wait-timeout","180","mongo","redis","mongo-init"],{timeout:240000,inherit:true});
    if(compose.code!==0)throw new Error("Local database startup failed. Run docker compose -p urbankare-infra -f docker-compose.infra.yml logs mongo mongo-init redis to inspect it. No database was deleted.");
    let healthy=false;
    for(let attempt=0;attempt<30;attempt++){if(await ready(environment)){healthy=true;break;}await sleep(1000);}
    if(!healthy)throw new Error("MongoDB/Redis started but their replica-set/PING readiness checks failed. Inspect the Compose logs before retrying.");
  }
  console.log("MongoDB replica set and Redis are ready on local ports 27018 / 6380.");
  if(initialize){
    const tsx=path.join(workspace,"node_modules","tsx","dist","cli.mjs");
    if(!existsSync(tsx))throw new Error("Database initialization needs tsx. Install development dependencies locally, or run the worker-image db:init command for deployment.");
    const result=await run(process.execPath,[tsx,"scripts/db-init.ts"],{timeout:120000,inherit:true,env:environment});
    if(result.code!==0)throw new Error("The database is running, but index/catalogue initialization failed. Run npm run db:init to inspect the error. Existing records are retained.");
  }
  return {managed:true};
}
