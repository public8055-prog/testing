import { passwordLoginSchema } from "@/lib/auth-input";
import { loginSessionWithPassword } from "@/lib/auth";
import { apiError,assertSameOrigin,HttpError,rateLimit,readJson,requestIp } from "@/lib/http";
// The shared sign-in accepts the same bounded identifiers as the protected seed.
const schema=passwordLoginSchema;
export async function POST(req:Request){try{assertSameOrigin(req);await rateLimit(`login-ip:${requestIp(req)}`,5,900000);const parsed=schema.safeParse(await readJson(req));if(!parsed.success)throw new HttpError(400,"Enter your email or login ID and password.");await rateLimit(`login:${parsed.data.email}`,5,900000);const result=await loginSessionWithPassword(parsed.data.email,parsed.data.password,requestIp(req));return Response.json(result,{headers:{"Cache-Control":"no-store"}});}catch(error){return apiError(error);}}
