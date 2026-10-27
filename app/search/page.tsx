import { readCategories, readServices } from "@/lib/db";
import { CatalogResults } from "@/components/service-detail/catalog-results";
import { CatalogUnavailable } from "@/components/service-detail/catalog-unavailable";

export const dynamic = "force-dynamic";
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string; category?: string }> }) {
  const [params, result] = await Promise.all([searchParams, Promise.all([readServices(), readCategories()]).catch(() => null)]);
  if (!result) return <CatalogUnavailable />;
  const [services, categories] = result;
  const query = typeof params.q === "string" ? params.q : "";
  const category = categories.some(c => c.slug === params.category) ? params.category! : "all";
  return <CatalogResults key={`${query}:${category}`} services={services} categories={categories} initialQuery={query} initialCategory={category} />;
}
