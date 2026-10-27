import { requireUser } from "@/lib/auth";
import { apiError, assertSameOrigin, readJson, HttpError, rateLimit } from "@/lib/http";
import { getMarketplaceBooking, transitionMarketplaceBooking } from "@/lib/marketplace";
export async function GET(_req:Request,ctx:{params:Promise<{id:string}>}){try{const user=await requireUser();const {id}=await ctx.params;const booking=await getMarketplaceBooking(user.id,id);if(!booking)throw new HttpError(404,"Booking not found.");return Response.json({booking},{headers:{"Cache-Control":"no-store"}});}catch(error){return apiError(error);}}
export async function PATCH(req:Request,ctx:{params:Promise<{id:string}>}){try{assertSameOrigin(req);const user=await requireUser();await rateLimit(`provider-booking-status:${user.id}`,60,60000);const {id}=await ctx.params;const data=await readJson(req);return Response.json(await transitionMarketplaceBooking(user.id,id,data?.status),{headers:{"Cache-Control":"no-store"}});}catch(error){return apiError(error);}}

