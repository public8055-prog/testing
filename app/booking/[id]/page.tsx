import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getMarketplaceProvider } from "@/lib/marketplace";
import { BookingFlow } from "@/components/marketplace/booking-flow";
export const dynamic="force-dynamic";
export default async function BookingPage({params}:{params:Promise<{id:string}>}){
 const {id}=await params;const user=await getCurrentUser();if(!user)redirect("/login?next="+encodeURIComponent("/booking/"+id));const provider=await getMarketplaceProvider(id);if(!provider)notFound();return <BookingFlow provider={provider}/>;
}

