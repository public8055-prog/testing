import {notFound,redirect} from "next/navigation";
import {getCurrentUser} from "@/lib/auth";
import {readBookingLocation} from "@/lib/booking-location";
import {HttpError} from "@/lib/http";
import {LocationWorkspace} from "@/components/locations/location-workspace";
export const dynamic="force-dynamic";
export const metadata={title:"Service location | SanjuNow",robots:{index:false,follow:false}};
export default async function ServiceLocationPage({params}:{params:Promise<{source:string;id:string}>}){
  const {source,id}=await params,user=await getCurrentUser();
  if(!user)redirect(`/login?next=${encodeURIComponent(`/locations/${source}/${id}`)}`);
  let initial;
  try{initial=await readBookingLocation(user,source,id);}
  catch(error){if(error instanceof HttpError&&(error.status===404||error.status===403))notFound();throw error;}
  return <LocationWorkspace key={`${source}:${id}`} initial={initial}/>;
}
