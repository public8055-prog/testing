import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { HttpError } from "./http";
import * as argon2 from "argon2";

// Argon2id exceeds OWASP's minimum 19 MiB / two iterations / one lane.
export const PASSWORD_HASH_POLICY=Object.freeze({algorithm:"argon2id",version:19,memoryCost:65536,timeCost:3,parallelism:1,hashLength:32,saltBytes:16});
export const PASSWORD_WORK_LIMITS=Object.freeze({concurrency:2,maxQueued:8,waitMs:3000});
export const DUMMY_PASSWORD_HASH=`$argon2id$v=19$m=65536,t=3,p=1$${Buffer.alloc(16).toString("base64").replace(/=+$/,"")}$${Buffer.alloc(32).toString("base64").replace(/=+$/,"")}`;

type LimiterOptions={concurrency:number;maxQueued:number;waitMs:number};
/** Each queued job is bounded in lifetime and count; only running jobs allocate scrypt memory. */
export function createPasswordWorkLimiter({concurrency,maxQueued,waitMs}:LimiterOptions){
  if(!Number.isInteger(concurrency)||concurrency<1||!Number.isInteger(maxQueued)||maxQueued<0||!Number.isFinite(waitMs)||waitMs<1)throw new Error("Invalid password work limits.");
  let active=0;
  const queue:{start:()=>void;timer:ReturnType<typeof setTimeout>}[]=[];
  const busy=()=>new HttpError(503,"Password processing is busy. Please try again shortly.",2);
  function drain(){while(active<concurrency&&queue.length){const next=queue.shift()!;clearTimeout(next.timer);next.start();}}
  return function run<T>(work:()=>Promise<T>):Promise<T>{
    return new Promise<T>((resolve,reject)=>{
      const start=()=>{active++;void Promise.resolve().then(work).then(resolve,reject).finally(()=>{active--;drain();});};
      if(active<concurrency){start();return;}
      if(queue.length>=maxQueued){reject(busy());return;}
      const entry:{start:()=>void;timer:ReturnType<typeof setTimeout>}={start,timer:setTimeout(()=>{const index=queue.indexOf(entry);if(index>=0){queue.splice(index,1);reject(busy());}},waitMs)};
      queue.push(entry);
    });
  };
}
const globalPasswordWork=globalThis as typeof globalThis&{urbanKarePasswordWork?:ReturnType<typeof createPasswordWorkLimiter>};
const run=globalPasswordWork.urbanKarePasswordWork??=createPasswordWorkLimiter(PASSWORD_WORK_LIMITS);

function parse(stored:string){
  if(typeof stored!=="string")return null;
  const argon=/^\$argon2id\$v=19\$([^$]+)\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/.exec(stored);
  // PHC parameter order is not semantic; node-argon2 versions emit m,t,p or m,p,t.
  // Exact sorted costs still reject duplicates, extra parameters and unbounded work.
  if(argon&&argon[1].split(",").sort().join(",")==="m=65536,p=1,t=3")return {algorithm:"argon2id" as const,legacy:false};
  const current=/^\$scrypt\$v=1\$N=131072,r=8,p=1\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(stored);
  if(current)return {algorithm:"scrypt" as const,salt:current[1],digest:current[2],N:131072,legacy:true};
  const legacy=/^([a-fA-F0-9]{32}):([a-fA-F0-9]{128})$/.exec(stored);
  return legacy?{algorithm:"scrypt" as const,salt:legacy[1],digest:legacy[2],N:16384,legacy:true}:null;
}
function derive(password:string,salt:string,N:number){
  return run(()=>new Promise<Buffer>((resolve,reject)=>scrypt(password,salt,64,{N,r:8,p:1,maxmem:192*1024*1024},(error,key)=>error?reject(error):resolve(key))));
}
export function passwordNeedsUpgrade(stored:string){return parse(stored)?.legacy===true;}
export async function hashPassword(password:string){
  if(typeof password!=="string"||password.length<1||password.length>128)throw new HttpError(400,"Password length is invalid.");
  // Do not trim, truncate or normalize passwords, including Unicode and embedded NULs.
  return run(()=>argon2.hash(password,{type:argon2.argon2id,version:PASSWORD_HASH_POLICY.version,memoryCost:PASSWORD_HASH_POLICY.memoryCost,timeCost:PASSWORD_HASH_POLICY.timeCost,parallelism:PASSWORD_HASH_POLICY.parallelism,hashLength:PASSWORD_HASH_POLICY.hashLength,salt:randomBytes(PASSWORD_HASH_POLICY.saltBytes)}));
}
export async function checkPassword(password:string,stored:string){
  if(typeof password!=="string"||password.length<1||password.length>128)return false;
  const parsed=parse(stored);if(!parsed)return false;
  if(parsed.algorithm==="argon2id")return run(()=>argon2.verify(stored,password));
  // Only the fixed current cost and exact legacy format are accepted: stored cost
  // strings cannot request arbitrary native memory/CPU allocations.
  const actual=await derive(password,parsed.salt,parsed.N),expected=Buffer.from(parsed.digest,"hex");
  return actual.length===expected.length&&timingSafeEqual(actual,expected);
}
