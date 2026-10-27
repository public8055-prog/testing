import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isAdminRole, canonicalRole } from "@/lib/roles";
export default async function Account({searchParams}:{searchParams:Promise<{next?:string}>}) { const user=await getCurrentUser(); const {next}=await searchParams; if(!user) redirect(`/login${next?`?next=${encodeURIComponent(next)}`:""}`); redirect(isAdminRole(user.role)?"/admin/dashboard":canonicalRole(user.role)==="PROVIDER"?"/provider/dashboard":"/dashboard"); }
