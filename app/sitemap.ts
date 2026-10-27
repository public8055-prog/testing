import type { MetadataRoute } from "next";
import { businessDetails } from "@/lib/business";
import { readServices, readCategories } from "@/lib/db";
export const dynamic = "force-dynamic";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const business = businessDetails(); if (!business.launchReady || !business.publicOrigin) return [];
  const [services, categories] = await Promise.all([readServices(), readCategories()]);
  const paths = ["", "/services", "/about", "/how-it-works", "/for-businesses", "/become-a-provider", "/pricing", "/contact", "/privacy", "/terms", "/cookies", "/refund-policy", ...services.map(service => `/services/${encodeURIComponent(service.slug)}`), ...categories.map(category => `/categories/${encodeURIComponent(category.slug)}`)];
  return paths.map(path => ({ url: `${business.publicOrigin}${path}`, changeFrequency: path.startsWith("/services/") ? "weekly" : "monthly", priority: path === "" ? 1 : 0.6 }));
}
