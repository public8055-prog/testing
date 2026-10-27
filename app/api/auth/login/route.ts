import { z } from "zod";
import { loginSessionWithPassword } from "@/lib/auth";
import { apiError,assertSameOrigin,HttpError,rateLimit,readJson,requestIp } from "@/lib/http";
const schema=z.object({email:z.string().trim().toLowerCase().max(254).pipe(z.email()),password:z.string().min(1).max(128)});
export async function POST(req:Request){try{assertSameOrigin(req);await rateLimit(`login-ip:${requestIp(req)}`,10,900000);const parsed=schema.safeParse(await readJson(req));if(!parsed.success)throw new HttpError(400,"Enter your email or login ID and password.");await rateLimit(`login:${parsed.data.email}`,5,900000);const result=await loginSessionWithPassword(parsed.data.email,parsed.data.password,requestIp(req));return Response.json(result,{headers:{"Cache-Control":"no-store"}});}catch(error){return apiError(error);}}
