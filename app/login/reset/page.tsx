import { PasswordResetForm } from "@/components/platform/password-reset-form";
import { passwordResetConfigured } from "@/lib/password-reset";
import {isBuiltinCatalog} from "@/lib/runtime-config.mjs";
import {AccountsUnavailable} from "@/components/site/accounts-unavailable";
export const dynamic="force-dynamic";
export const metadata={title:"Reset your password | SanjuNow",referrer:"no-referrer" as const};
export default async function ResetPage({searchParams}:{searchParams:Promise<{token?:string}>}){if(isBuiltinCatalog())return <AccountsUnavailable/>;const {token}=await searchParams;return <PasswordResetForm token={token} configured={passwordResetConfigured()}/>;}
