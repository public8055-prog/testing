import { PasswordResetForm } from "@/components/platform/password-reset-form";
import { passwordResetConfigured } from "@/lib/password-reset";
export const dynamic="force-dynamic";
export const metadata={title:"Reset your password | UrbanKare",referrer:"no-referrer" as const};
export default async function ResetPage({searchParams}:{searchParams:Promise<{token?:string}>}){const {token}=await searchParams;return <PasswordResetForm token={token} configured={passwordResetConfigured()}/>;}
