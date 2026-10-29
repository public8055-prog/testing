import { passwordLoginSchema } from "@/lib/auth-input";
import { loginSessionWithPassword } from "@/lib/auth";
import { LOGIN_ATTEMPT_LIMIT } from "@/lib/auth-state";
import { apiError, assertSameOrigin, HttpError, rateLimit, readJson, requestIp } from "@/lib/http";
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const parsed = passwordLoginSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new HttpError(400, "Enter your email or login ID and password.");
    const ip = requestIp(req), email = parsed.data.email;
    // Separate accounts on shared Wi-Fi must not consume each other's sign-in budget.
    await rateLimit(`login-v2:pair:${ip}:${email}`, LOGIN_ATTEMPT_LIMIT, 900000);
    await rateLimit(`login-v2:identity:${email}`, LOGIN_ATTEMPT_LIMIT, 900000);
    const result = await loginSessionWithPassword(email, parsed.data.password, ip);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
