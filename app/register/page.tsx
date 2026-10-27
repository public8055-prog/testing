import { AuthForm } from "@/components/platform/auth-form";
export default async function Register({searchParams}:{searchParams:Promise<{next?:string}>}){const query=await searchParams;return <AuthForm mode="register" next={query.next}/>;}
