import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getWorkforceSnapshot } from "@/lib/workforce";
import { WorkforceWorkspace } from "@/components/workforce/workspace";
export const dynamic="force-dynamic";
export const metadata={title:"Business workspace | UrbanKare",description:"Manage workers, shifts, attendance, and monthly timesheets in your private business workspace."};
export default async function BusinessPage({params,searchParams}:{params:Promise<{section:string}>;searchParams:Promise<{month?:string}>}){
 const {section}=await params;
 if(!["dashboard","workers","schedules","attendance","timesheets","reports","services","settings"].includes(section))notFound();
 const user=await getCurrentUser();if(!user)redirect(`/login?next=${encodeURIComponent(`/business/${section}`)}`);
 const data=await getWorkforceSnapshot(user.id,(await searchParams).month);
 if(data.role==="worker"&&["workers","reports","services","settings"].includes(section))redirect("/business/attendance");
 return <WorkforceWorkspace key={section} initial={data} section={section} userName={user.name}/>;
}
