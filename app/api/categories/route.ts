import { NextResponse } from "next/server";
import { readCategories } from "@/lib/db";
import { apiError } from "@/lib/http";

export async function GET() {
  try{return NextResponse.json({ categories:await readCategories() },{headers:{"Cache-Control":"no-store"}});}catch(e){return apiError(e);}
}
