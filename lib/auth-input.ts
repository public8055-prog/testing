import { z } from "zod";

/** One shared format for sign-in and trusted provisioning; never encodes a role. */
export const loginIdentifierSchema = z.string().trim().toLowerCase().min(3).max(254).regex(/^[^\s<>\p{Cc}]+$/u);
export const passwordLoginSchema = z.object({
  email: loginIdentifierSchema,
  password: z.string().min(1).max(128),
});

export function registrationRequiresEmailVerification(environment: Record<string, string | undefined>, mailConfigured: boolean) {
  if (mailConfigured || environment.VERCEL === "1") return true;
  try {
    const origin = new URL(environment.APP_URL || "");
    const privatePreview = environment.COOKIE_SECURE === "false" && environment.PUBLIC_LAUNCH_READY !== "true" && origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) && !origin.username && !origin.password;
    return !privatePreview;
  } catch { return true; }
}
