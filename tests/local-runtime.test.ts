import {strict as assert} from "node:assert";
import {test} from "node:test";
import {ensureLocalRuntime,usesManagedLocalData,installMayStartServices,developmentArguments} from "../scripts/local-runtime.mjs";

const local={MONGODB_URI:"mongodb://127.0.0.1:27018/?replicaSet=rs0&directConnection=true",REDIS_URL:"redis://127.0.0.1:6380"};
test("Windows development defaults to the verified bundler and preserves explicit CLI choices",()=>{
  assert.deepEqual(developmentArguments(["--port","3001"],"win32"),["--port","3001","--webpack"]);
  for(const flag of ["--webpack","--turbopack","--turbo","--help"]){const args=[flag];assert.deepEqual(developmentArguments(args,"win32"),args);}
  assert.deepEqual(developmentArguments([],"linux"),[]);
});
test("automatic infrastructure is restricted to the exact uncredentialed local endpoints",()=>{
  assert.equal(usesManagedLocalData(local),true);
  for(const changed of [{MONGODB_URI:"mongodb://mongo:27017"},{MONGODB_URI:"mongodb://127.0.0.1:27017"},{MONGODB_URI:"mongodb+srv://cluster.example.test"},{REDIS_URL:"rediss://redis.example.test:6380"},{REDIS_URL:"redis://127.0.0.1:6379"},{REDIS_URL:"redis://qa:secret@127.0.0.1:6380"}])assert.equal(usesManagedLocalData({...local,...changed}),false);
});
test("installation avoids CI, production, Docker builds and explicit opt-outs",()=>{
  assert.equal(installMayStartServices({}),true);
  for(const environment of [{CI:"true"},{NODE_ENV:"production"},{DOCKER_BUILD:"1"},{AUTO_START_LOCAL_INFRA:"false"}])assert.equal(installMayStartServices(environment),false);
});
test("healthy local services are reused without Docker calls or data reinitialization when requested",async()=>{
  assert.deepEqual(await ensureLocalRuntime({environment:local,initialize:false,ready:async()=>true,run:async()=>{throw new Error("Docker should not run");}}),{managed:true});
});
test("external services and explicit local opt-outs never start containers",async()=>{
  for(const environment of [{...local,AUTO_START_LOCAL_INFRA:"false"},{...local,MONGODB_URI:"mongodb+srv://cluster.example.test"}])assert.deepEqual(await ensureLocalRuntime({environment,ready:async()=>{throw new Error("Should not probe");}}),{managed:false});
});
test("cold startup launches Docker Desktop, waits for its engine and checks actual data readiness",async()=>{
  const calls:string[][]=[];let probes=0,info=0;
  const result=await ensureLocalRuntime({environment:local,initialize:false,sleep:async()=>{},ready:async()=>++probes>2,run:async(file:string,args:string[])=>{calls.push([file,...args]);return{code:args[0]==="info"&&++info<3?1:0,output:""};}});
  assert.deepEqual(result,{managed:true});assert(calls.some(call=>call.join(" ")==="docker desktop start --detach"));
  const compose=calls.find(call=>call[1]==="compose")!;assert(compose.includes("--wait"));assert.deepEqual(compose.slice(-3),["mongo","redis","mongo-init"]);assert(!calls.some(call=>call.includes("down")||call.includes("-v")));
});
test("missing Docker and failed Compose stop startup with recovery guidance",async()=>{
  await assert.rejects(ensureLocalRuntime({environment:local,ready:async()=>false,run:async()=>({code:127,output:""})}),/Docker Desktop is required/);
  await assert.rejects(ensureLocalRuntime({environment:local,ready:async()=>false,run:async(_file:string,args:string[])=>({code:args[0]==="compose"?1:0,output:""})}),/No database was deleted/);
});
test("a disappearing Docker executable fails promptly without an endless engine wait",async()=>{
  await assert.rejects(ensureLocalRuntime({environment:local,ready:async()=>false,sleep:async()=>{},run:async(_file:string,args:string[])=>({code:args[0]==="info"?127:0,output:""})}),/Docker executable is no longer available/);
});
test("ready startup initializes only the selected environment and surfaces initializer failure",async()=>{
  let initialized=false;
  await ensureLocalRuntime({environment:local,ready:async()=>true,run:async(file:string,args:string[],options?:{env?:Record<string,string|undefined>})=>{
    assert.equal(file,process.execPath);assert.equal(args.at(-1),"scripts/db-init.ts");assert.equal(options?.env,local);initialized=true;return{code:0,output:""};
  }});assert.equal(initialized,true);
  await assert.rejects(ensureLocalRuntime({environment:local,ready:async()=>true,run:async()=>({code:1,output:""})}),/Existing records are retained/);
});
