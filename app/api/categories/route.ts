import { NextResponse } from "next/server";
import { readCategories } from "@/lib/db";
import { apiError } from "@/lib/http";
import {catalogCacheControl} from "@/lib/runtime-config.mjs";

export async function GET() {
  try{return NextResponse.json({ categories:await readCategories() },{headers:{"Cache-Control":catalogCacheControl()}});}catch(e){return apiError(e);}
}
