import { NextResponse } from "next/server";
import { readServices } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import {catalogCacheControl} from "@/lib/runtime-config.mjs";

export async function GET(req: Request) {
 try {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").toLowerCase();
  const category = searchParams.get("category") ?? "";
  const page = Number(searchParams.get("page") || 1), limit = Number(searchParams.get("limit") || 50);
  if (q.length > 200 || category.length > 100 || !Number.isSafeInteger(page) || page < 1 || page > 10000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new HttpError(400, "Choose a valid search and page size between 1 and 100.");
  let out = await readServices(category || undefined);
  if (category) out = out.filter((s) => s.category === category);
  if (q)
    out = out.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q)
    );
  return NextResponse.json({ services: out.slice((page - 1) * limit, page * limit), total: out.length, page, limit },{headers:{"Cache-Control":catalogCacheControl()}});
 } catch(e){return apiError(e);}
}
