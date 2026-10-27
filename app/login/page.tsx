import { AuthForm } from "@/components/platform/auth-form";
import { emailOtpConfigured } from "@/lib/auth-otp";
export default async function Login({searchParams}:{searchParams:Promise<{next?:string}>}){const query=await searchParams;return <AuthForm next={query.next} otpConfigured={emailOtpConfigured()}/>;};
