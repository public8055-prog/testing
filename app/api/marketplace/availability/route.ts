import { getMarketplaceAvailability } from "@/lib/marketplace";
import { apiError, HttpError } from "@/lib/http";
export async function GET(req:Request){try{const providerId=new URL(req.url).searchParams.get("provider");if(!providerId)throw new HttpError(400,"Choose a provider.");return Response.json({reserved:await getMarketplaceAvailability(providerId),timezone:"Asia/Kolkata"});}catch(error){return apiError(error);}}

