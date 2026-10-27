import {spawn} from "node:child_process";
import {readFile,mkdir,writeFile,unlink} from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import {ensureLocalRuntime,loadRuntimeEnvironment,workspace,command,developmentArguments} from "./local-runtime.mjs";
import {childExitCode} from "./process-lifecycle.mjs";

loadRuntimeEnvironment(true);
const args=developmentArguments(process.argv.slice(2)),metadata=path.join(workspace,".data","dev-server.json");
async function listening(port){return new Promise(resolve=>{const socket=net.connect({host:"localhost",port});let done=false;const finish=value=>{if(done)return;done=true;socket.destroy();resolve(value);};socket.once("connect",()=>finish(true));socket.once("error",()=>finish(false));socket.setTimeout(1000,()=>finish(false));});}
async function existingServer(){
  // Launcher metadata records the actual Next URL. A cold route compilation
  // must not be mistaken for a second server being needed.
  try{const server=JSON.parse(await readFile(metadata,"utf8"));process.kill(server.pid,0);if(server.workspace===workspace&&await listening(server.port))return server;}catch{/* Next's own lock remains authoritative if this record is stale. */}
  if(process.platform==="win32"){
    // Inspect command identity and listener ownership, never terminate a process.
    const inspected=await command("powershell.exe",["-NoProfile","-NonInteractive","-Command",'$rootPath=$env:URBANKARE_DEV_ROOT; @(Get-CimInstance Win32_Process | Where-Object {$_.Name -eq "node.exe" -and $_.CommandLine -like ("*"+$rootPath+"*next*start-server*")} | Select-Object -ExpandProperty ProcessId) | ConvertTo-Json -Compress'],{timeout:15000,env:{...process.env,URBANKARE_DEV_ROOT:workspace}});
    if(inspected.code===0&&inspected.output.trim()){
      try{
        const owned=new Set([JSON.parse(inspected.output)].flat());
        // netstat also works when the Windows NetTCPIP provider returns no rows.
        const listeners=await command("netstat.exe",["-ano","-p","tcp"],{maxOutputBytes:1048576});
        const candidates=listeners.output.split(/\r?\n/).flatMap(line=>{const match=/^\s*TCP\s+(0\.0\.0\.0|\[::\]):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/.exec(line);return match&&owned.has(Number(match[3]))?[{pid:Number(match[3]),port:Number(match[2])}]:[];}).sort((a,b)=>a.port-b.port);
        for(const server of candidates)if(await listening(server.port))return server;
      }catch{/* Next's own lock remains the fallback. */}
    }
  }
  return null;
}
try{
  if(args.includes("--help")||args.includes("-h")){
    const child=spawn(process.execPath,[path.join(workspace,"node_modules/next/dist/bin/next"),"dev",...args],{cwd:workspace,stdio:"inherit",windowsHide:true});child.on("exit",code=>{process.exitCode=code??1;});
  }else{
    await ensureLocalRuntime();
    const existing=await existingServer();
    if(existing){console.log(`The development server for this folder is already running at http://localhost:${existing.port} (PID ${existing.pid}). Reusing it; MongoDB and Redis are ready. Stop it with Ctrl+C in its original terminal before changing server options.`);}
    else{
      const child=spawn(process.execPath,[path.join(workspace,"node_modules/next/dist/bin/next"),"dev",...args],{cwd:workspace,env:process.env,stdio:["inherit","pipe","pipe"],windowsHide:true});
      let duplicate=false,shutdown=false,tail="",writePending=Promise.resolve();
      function output(chunk,stream){stream.write(chunk);tail=(tail+chunk.toString().replace(/\u001b\[[0-9;]*m/g,"")).slice(-4096);if(tail.includes("Another next dev server is already running"))duplicate=true;const match=/Local:\s+https?:\/\/[^\s:]+:(\d+)/.exec(tail);if(match&&!duplicate){writePending=writePending.then(async()=>{
        await mkdir(path.dirname(metadata),{recursive:true});
        try{const previous=JSON.parse(await readFile(metadata,"utf8"));process.kill(previous.pid,0);if(previous.workspace===workspace&&await listening(previous.port))return;}catch{/* A dead record can be replaced by this launcher. */}
        await writeFile(metadata,JSON.stringify({pid:child.pid,port:Number(match[1]),workspace}));
      }).catch(()=>{});}}
      child.stdout.on("data",chunk=>output(chunk,process.stdout));child.stderr.on("data",chunk=>output(chunk,process.stderr));
      for(const signal of ["SIGINT","SIGTERM"])process.on(signal,()=>{shutdown=true;child.kill(signal);});
      child.on("error",()=>{console.error("The Next.js development process could not start.");process.exitCode=1;});
      child.on("exit",async(code,signal)=>{await writePending;try{const current=JSON.parse(await readFile(metadata,"utf8"));if(current.pid===child.pid)await unlink(metadata);}catch{/* Never remove another process's metadata. */}process.exitCode=duplicate?0:childExitCode(code,signal,shutdown);});
    }
  }
}catch(error){console.error(error.message);process.exitCode=1;}
