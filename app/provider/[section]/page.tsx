import { redirect,notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getProviderForUser,listMarketplaceBookings,getMarketplaceReviews } from "@/lib/marketplace";
import { readMarketplaceCategories } from "@/lib/marketplace-categories";
import { ProviderWorkspace } from "@/components/marketplace/provider-workspace";
export const dynamic="force-dynamic";
const sections=["dashboard","queue","documents","requests","bookings","calendar","attendance","earnings","reviews","profile","settings"];
export default async function ProviderPage({params}:{params:Promise<{section:string}>}){
 const {section}=await params;if(!sections.includes(section))notFound();const user=await getCurrentUser();if(!user)redirect("/login?next="+encodeURIComponent("/provider/"+section));
 const profile=await getProviderForUser(user.id);const bookings=profile?await listMarketplaceBookings(user.id,true):[];const reviews=profile?await getMarketplaceReviews(profile.id):[];
 return <ProviderWorkspace categories={(await readMarketplaceCategories()).map(c=>c.name)} section={section} profile={profile} bookings={bookings} reviews={reviews} name={user.name}/>;
}

