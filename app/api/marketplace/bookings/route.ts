import { requireUser } from "@/lib/auth";
import { apiError, assertSameOrigin, HttpError, readJson, rateLimit } from "@/lib/http";
import { createMarketplaceBooking, listMarketplaceBookings } from "@/lib/marketplace";
export async function GET(req:Request){try{const user=await requireUser();return Response.json({bookings:await listMarketplaceBookings(user.id,new URL(req.url).searchParams.get("view")==="provider")},{headers:{"Cache-Control":"no-store"}});}catch(error){return apiError(error);}}
export async function POST(req:Request){try{assertSameOrigin(req);const user=await requireUser();if (Number(user.email_verified) === 0) throw new HttpError(403, "Please verify your email before booking. Enter the 6-digit code we emailed you, or request a new one with email sign-in.");await rateLimit(`provider-booking:${user.id}`,30,3600000);return Response.json(await createMarketplaceBooking(user.id,await readJson(req)),{status:201,headers:{"Cache-Control":"no-store"}});}catch(error){return apiError(error);}}

