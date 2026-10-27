import { z } from "zod";
import { cartItemsSchema } from "@/lib/booking-rules";
import { quoteServices } from "@/lib/quote";
import { apiError, assertSameOrigin, HttpError, readJson } from "@/lib/http";
const schema=z.object({items:cartItemsSchema,date:z.string().optional()});
export async function POST(req:Request){try{assertSameOrigin(req);const parsed=schema.safeParse(await readJson(req));if(!parsed.success)throw new HttpError(400,parsed.error.issues[0]?.message||"Invalid cart.");return Response.json(await quoteServices(parsed.data.items,parsed.data.date),{headers:{"Cache-Control":"no-store"}});}catch(e){return apiError(e);}}
