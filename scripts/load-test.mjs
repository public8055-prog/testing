// Dependency-free smoke load test. This is not certification for 10,000 concurrent users.
import { performance } from 'node:perf_hooks';
const base=process.argv[2]||process.env.TEST_BASE_URL||'http://localhost:3000';
const concurrency=Math.min(500,Math.max(1,Number(process.env.CONCURRENCY)||25));
const total=Math.max(concurrency,Number(process.env.REQUESTS)||250);
let next=0,failed=0;const latency=[];const started=performance.now();
await Promise.all(Array.from({length:concurrency},async()=>{while(next++<total){const start=performance.now();try{const r=await fetch(`${base}/api/services`,{signal:AbortSignal.timeout(15000)});await r.arrayBuffer();if(!r.ok)failed++;}catch{failed++;}latency.push(performance.now()-start);}}));
latency.sort((a,b)=>a-b);
console.log(JSON.stringify({requests:latency.length,concurrency,failed,requestsPerSecond:Math.round(total/((performance.now()-started)/1000)),p95Ms:Math.round(latency[Math.floor(latency.length*.95)]),p99Ms:Math.round(latency[Math.floor(latency.length*.99)])},null,2));
if(failed)process.exitCode=1;
