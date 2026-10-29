import { AuthForm } from "@/components/platform/auth-form";
import { AccountsUnavailable } from "@/components/site/accounts-unavailable";
import { isBuiltinCatalog } from "@/lib/runtime-config.mjs";
export default async function Register({searchParams}:{searchParams:Promise<{next?:string}>}){if(isBuiltinCatalog())return <AccountsUnavailable/>;const query=await searchParams;return <AuthForm mode="register" next={query.next}/>;}
