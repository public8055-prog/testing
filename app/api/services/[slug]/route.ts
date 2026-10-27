import { NextResponse } from "next/server";
import { getCatalogService, readServices } from "@/lib/db";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const service = await getCatalogService(slug);
  if (!service)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const related = (await readServices(service.category))
    .filter((s) => s.slug !== slug)
    .slice(0, 4);
  return NextResponse.json({ service, related });
}
