import {requireUser} from "@/lib/auth";
import {apiError,assertSameOrigin,rateLimit,readJson} from "@/lib/http";
import {mutateBookingLocation,readBookingLocation} from "@/lib/booking-location";
export const dynamic="force-dynamic";
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,{params}:Context){try{
  const user=await requireUser(),{id}=await params;await rateLimit(`location-read:${user.id}`,60,60000);
  return Response.json(await readBookingLocation(user,new URL(request.url).searchParams.get("source")||"catalog",id),{headers:{"Cache-Control":"private, no-store"}});
}catch(error){return apiError(error);}}
export async function POST(request:Request,{params}:Context){try{
  assertSameOrigin(request);const user=await requireUser(),{id}=await params;await rateLimit(`location-write:${user.id}`,30,60000);
  return Response.json(await mutateBookingLocation(user,new URL(request.url).searchParams.get("source")||"catalog",id,await readJson(request)),{headers:{"Cache-Control":"private, no-store"}});
}catch(error){return apiError(error);}}
