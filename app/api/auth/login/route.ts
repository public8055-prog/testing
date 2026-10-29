import { passwordLoginSchema } from "@/lib/auth-input";
import { loginSessionWithPassword } from "@/lib/auth";
import { apiError, assertSameOrigin, HttpError, readJson, requestIp } from "@/lib/http";
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const parsed = passwordLoginSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new HttpError(400, "Enter your email or login ID and password.");
    const ip = requestIp(req), email = parsed.data.email;
    // authenticatedRecord atomically counts only failed credentials in Redis.
    // The proxy retains its independent global request-volume protection.
    const result = await loginSessionWithPassword(email, parsed.data.password, ip);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
