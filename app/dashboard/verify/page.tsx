import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { emailOtpConfigured } from "@/lib/auth-otp";
import { isAdminRole, canonicalRole } from "@/lib/roles";
import { EmailVerificationForm } from "@/components/platform/email-verification-form";

export default async function VerifyEmailPage() {
  const user = await requireUser();
  if (Number(user.email_verified) !== 0 || isAdminRole(user.role)) redirect(isAdminRole(user.role) ? "/admin/dashboard" : canonicalRole(user.role) === "PROVIDER" ? "/provider/dashboard" : "/dashboard");
  return <EmailVerificationForm email={user.email} configured={emailOtpConfigured()}/>;
}
