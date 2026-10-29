import { z } from "zod";
import { registerUser, loginSessionWithPassword } from "@/lib/auth";
import { emailOtpConfigured, requestEmailOtp } from "@/lib/auth-otp";
import { registrationRequiresEmailVerification } from "@/lib/auth-input";
import { apiError, assertSameOrigin, HttpError, rateLimit, readJson, requestIp } from "@/lib/http";
const schema = z.object({name:z.string().trim().min(2).max(80),email:z.string().trim().toLowerCase().pipe(z.email().max(254)),password:z.string().min(10).max(128),termsAccepted:z.literal(true),privacyConsent:z.literal(true),adultConfirmed:z.literal(true)});
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    await rateLimit(`register:${requestIp(req)}`, 15, 3600000);
    const result = schema.safeParse(await readJson(req));
    if (!result.success) throw new HttpError(400,"Enter valid account details, accept the terms and privacy policy, and confirm that you are 18 or older.");
    const mailConfigured = emailOtpConfigured();
    // Public deployments never fabricate mailbox verification if mail is down.
    const requireVerification = registrationRequiresEmailVerification(process.env, mailConfigured);
    await registerUser(result.data.name,result.data.email,result.data.password,{termsAccepted:result.data.termsAccepted,privacyConsent:result.data.privacyConsent,adultConfirmed:result.data.adultConfirmed},{requireVerification});
    const session = await loginSessionWithPassword(result.data.email,result.data.password,requestIp(req));
    if (mailConfigured) {
      try { await requestEmailOtp(result.data.email,"verify",requestIp(req)); }
      catch (error) { if (!(error instanceof HttpError) || (error.status !== 503 && error.status !== 429)) throw error; }
    }
    return Response.json({...session,verification:requireVerification&&mailConfigured,email:result.data.email},{status:201,headers:{"Cache-Control":"no-store"}});
  } catch(error) { return apiError(error); }
}
