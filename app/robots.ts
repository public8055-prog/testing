import type { MetadataRoute } from "next";
import { businessDetails } from "@/lib/business";
export const dynamic = "force-dynamic";
export default function robots(): MetadataRoute.Robots {
  const business = businessDetails();
  if (!business.launchReady) return { rules: { userAgent: "*", disallow: "/" } };
  return { rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/admin", "/dashboard", "/account", "/checkout", "/cart", "/business/", "/provider/", "/bookings", "/booking/", "/login", "/register"] }, sitemap: `${business.publicOrigin}/sitemap.xml` };
}
