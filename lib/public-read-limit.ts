import {createHash} from "node:crypto";
import {HttpError} from "./http";
const windows=new Map<string,number[]>();
/** Best-effort per-instance protection for immutable catalogue reads only.
 * Private APIs keep their shared Redis limiter and never use this fallback. */
export function limitPublicRead(identity:string,now=Date.now()){
  const key=createHash("sha256").update(identity).digest("hex");
  const recent=(windows.get(key)||[]).filter(time=>time>now-60000);
  if(recent.length>=100)throw new HttpError(429,"Too many catalogue requests. Please try again shortly.",Math.max(1,Math.ceil((recent[0]+60000-now)/1000)));
  if(!windows.has(key)&&windows.size>=4096){for(const [entry,times] of windows)if(times.at(-1)!<=now-60000)windows.delete(entry);if(windows.size>=4096)windows.delete(windows.keys().next().value!);}
  recent.push(now);windows.set(key,recent);
}
