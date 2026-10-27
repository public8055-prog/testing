import { requireUser } from "@/lib/auth";
import { apiError, assertSameOrigin, readJson, rateLimit } from "@/lib/http";
import { addMarketplaceReview } from "@/lib/marketplace";
export async function POST(req:Request){try{assertSameOrigin(req);const user=await requireUser();await rateLimit(`review:${user.id}`,20,3600000);const data=await readJson(req);return Response.json(await addMarketplaceReview(user.id,data?.booking_id,data?.rating,data?.body),{status:201,headers:{"Cache-Control":"no-store"}});}catch(error){return apiError(error);}}

