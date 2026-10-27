import { AuthForm } from "@/components/platform/auth-form";
import { emailOtpConfigured } from "@/lib/auth-otp";
import {isBuiltinCatalog} from "@/lib/runtime-config.mjs";
import {AccountsUnavailable} from "@/components/site/accounts-unavailable";
export default async function Login({searchParams}:{searchParams:Promise<{next?:string}>}){if(isBuiltinCatalog())return <AccountsUnavailable/>;const query=await searchParams;return <AuthForm next={query.next} otpConfigured={emailOtpConfigured()}/>;};
