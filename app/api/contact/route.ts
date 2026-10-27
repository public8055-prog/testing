import { apiError, assertSameOrigin, rateLimit, readJson, requestIp } from "@/lib/http";
import { createContact } from "@/lib/contact";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request); await rateLimit(`contact:${requestIp(request)}`, 5, 15 * 60000);
    return Response.json(await createContact(await readJson(request)), { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
