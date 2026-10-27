import { requireUser } from "@/lib/auth";
import { apiError, assertSameOrigin, readJson, rateLimit } from "@/lib/http";
import { getProviderForUser, saveMarketplaceProvider } from "@/lib/marketplace";
export async function GET(){try {const user=await requireUser();return Response.json({provider:await getProviderForUser(user.id)},{headers:{"Cache-Control":"no-store"}});}catch(error){return apiError(error);}}
export async function POST(req:Request){try{assertSameOrigin(req);const user=await requireUser();await rateLimit(`provider-profile:${user.id}`,20,3600000);return Response.json({provider:await saveMarketplaceProvider(user.id,await readJson(req))},{headers:{"Cache-Control":"no-store"}});}catch(error){return apiError(error);}}

