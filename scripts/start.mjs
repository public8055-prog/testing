import { existsSync, cpSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import net from "node:net";
import { createGateway } from "./gateway.mjs";
import { validateContainerConfiguration } from "./container-entrypoint.mjs";
import { resolvePublicOrigin } from "./public-origin.mjs";
import { childExitCode } from "./process-lifecycle.mjs";

const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
// loadEnvFile preserves existing environment values, so shell settings win,
// followed by the first file defining a key in Next's production precedence.
for(const name of [".env.production.local",".env.local",".env.production",".env"]){const file=path.join(workspace,name);if(existsSync(file))process.loadEnvFile(file);}
// Apply the same production security boundary when launched outside Docker.
validateContainerConfiguration();
const packaged=existsSync(path.join(workspace,"server.js"));
if(!packaged&&existsSync(path.join(workspace,"docker-compose.infra.yml"))){
  const {ensureLocalRuntime}=await import("./local-runtime.mjs");
  await ensureLocalRuntime();
}
const output=packaged?workspace:path.join(workspace,".next","standalone");
const server=path.join(output,"server.js");
if(!existsSync(server))throw new Error("Production build missing. Run npm run build -- --webpack first.");
const args=process.argv.slice(2);
const portArg=args.indexOf("--port");
const port=Number(portArg>=0?args[portArg+1]:process.env.PORT||3000);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error("Choose a valid --port between 1 and 65535.");
// Next's standalone output omits public/static assets. Copy only those authored
// assets; environment files, customer databases and test artifacts stay outside.
if(!packaged){cpSync(path.join(workspace,"public"),path.join(output,"public"),{recursive:true});cpSync(path.join(workspace,".next","static"),path.join(output,".next","static"),{recursive:true});}
// Keep local previews bound to loopback. Deployments can explicitly set HOSTNAME.
const hostname=process.env.HOSTNAME||"localhost";
const upstreamPort=Number(process.env.INTERNAL_APP_PORT||port+1);
if(!Number.isInteger(upstreamPort)||upstreamPort===port||upstreamPort<1||upstreamPort>65535)throw new Error("Choose a distinct valid INTERNAL_APP_PORT.");
const publicOrigin=resolvePublicOrigin(process.env.APP_URL,port,{explicitPort:portArg>=0});
const child=spawn(process.execPath,[server],{
  cwd:output,stdio:"inherit",
  // Only the loopback gateway can reach this listener. It replaces forwarded identities.
  env:{...process.env,HOSTNAME:"127.0.0.1",PORT:String(upstreamPort),TRUST_PROXY:"true",INTERNAL_GATEWAY_ORIGIN:publicOrigin},
});
child.on("error",error=>{console.error(error.message);process.exitCode=1;});
let closing=false,shutdownRequested=false,closeGateway;
const stop=async()=>{if(closing)return;closing=true;await closeGateway?.();child.kill("SIGTERM");};
child.on("exit",(code,signal)=>{process.exitCode=childExitCode(code,signal,shutdownRequested);void stop();});
for(const signal of ["SIGINT","SIGTERM"])process.on(signal,()=>{shutdownRequested=true;void stop();});
const deadline=Date.now()+30000;
while(!closing){
  const ready=await new Promise(resolve=>{const socket=net.connect({host:"127.0.0.1",port:upstreamPort});socket.once("connect",()=>{socket.destroy();resolve(true);});socket.once("error",()=>{socket.destroy();resolve(false);});socket.setTimeout(500,()=>{socket.destroy();resolve(false);});});
  if(ready)break;if(Date.now()>deadline){await stop();throw new Error("The internal application did not start.");}await new Promise(resolve=>setTimeout(resolve,100));
}
if(!closing){try{closeGateway=await createGateway({port,hostname,upstreamPort});console.log(JSON.stringify({level:"info",event:"gateway.ready",port,websocketPath:"/api/live"}));}catch(error){await stop();throw error;}}
