import { notFound,redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { customerData } from "@/lib/platform";
import { listMarketplaceBookings,getMarketplaceBooking } from "@/lib/marketplace";
import { getBooking } from "@/lib/db";
import { WorkspaceShell } from "@/components/platform/shell";
import { CustomerWorkspace } from "@/components/platform/customer";
export const dynamic="force-dynamic";
export default async function Dashboard({params}:{params:Promise<{section?:string[]}>}){const {section=[]}=await params;const key=section[0]||"overview";if(!["overview","bookings","favorites","reviews","notifications","profile","settings"].includes(key)||section.length>2||(section.length===2&&key!=="bookings"))notFound();const user=await getCurrentUser();if(!user)redirect(`/login?next=${encodeURIComponent(`/dashboard${section.length?`/${section.join("/")}`:""}`)}`);const[data,marketBookings]=await Promise.all([customerData(user.id),listMarketplaceBookings(user.id)]);if(section[1]){const booking=await getMarketplaceBooking(user.id,section[1]);if(booking?.customer_id===user.id&&!marketBookings.some(b=>b.id===booking.id))marketBookings.push(booking);if(!booking||booking.customer_id!==user.id){const legacy=await getBooking(section[1],user.id);if(legacy)redirect(`/bookings/${legacy.id}`);notFound();}}return <WorkspaceShell name={user.name}><CustomerWorkspace user={user} data={data} marketBookings={marketBookings} section={key} id={section[1]}/></WorkspaceShell>;}
