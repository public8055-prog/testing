import { z } from "zod";
import { requireAdmin, clearAuthenticationCookies } from "@/lib/auth";
import { changeAdminPassword } from "@/lib/admin-password";
import { apiError, assertSameOrigin, HttpError, rateLimit, readJson } from "@/lib/http";

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const user = await requireAdmin();
    await rateLimit(`admin-password:${user.id}`, 10, 900000);
    const parsed = z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(10).max(128) }).safeParse(await readJson(req));
    if (!parsed.success) throw new HttpError(400, "Enter your current password and a new password of 10 to 128 characters.");
    await changeAdminPassword(user.id, parsed.data.currentPassword, parsed.data.newPassword);
    await clearAuthenticationCookies();
    return Response.json({ message: "Password changed. Please sign in again." }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
