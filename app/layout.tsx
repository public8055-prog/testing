import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Header } from "@/components/site/header";
import { Footer } from "@/components/site/footer";
import { VerifyEmailBanner } from "@/components/site/verify-email-banner";
import { CartHydration } from "@/components/cart-hydration";
import { ServiceUpdates } from "@/components/operations/service-updates";
import { AccountSessionProvider } from "@/components/site/session-provider";
import { MobileNavigation } from "@/components/site/mobile-navigation";
import { businessDetails } from "@/lib/business";
import {isBuiltinCatalog} from "@/lib/runtime-config.mjs";
export const dynamic = "force-dynamic";
const business = businessDetails();

export const metadata: Metadata = {
  metadataBase: new URL(business.publicOrigin || "http://localhost:3000"),
  robots: { index: business.launchReady, follow: business.launchReady },
  openGraph: { type: "website", siteName: "UrbanKare", title: "UrbanKare — Local services & workforce management", description: "Find local services, follow your bookings and manage team attendance.", locale: "en_IN" },
  twitter: { card: "summary_large_image" },
  verification: process.env.GOOGLE_SITE_VERIFICATION ? { google: process.env.GOOGLE_SITE_VERIFICATION } : undefined,
  title: "UrbanKare — Local Services & Smarter Workforce Management",
  description:
    "One platform. Many services. Simple attendance. Book local professionals and manage your workers, schedules and attendance with UrbanKare.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#ffffff" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const catalogOnly=isBuiltinCatalog();
  return (
    <html lang="en" className="h-full" data-scroll-behavior="smooth">
      <body className="app-body flex min-h-full flex-col bg-[#fafafa] text-zinc-900 antialiased">
        <AccountSessionProvider catalogOnly={catalogOnly}>
          <CartHydration />
          <Header />
          <VerifyEmailBanner />
          {catalogOnly&&<aside aria-label="Service availability" className="border-b border-teal-200 bg-teal-50 px-5 py-3 text-center text-sm leading-6 text-teal-900">Explore our services and indicative prices. Online bookings are not open yet.</aside>}
          <main id="main-content" className="flex-1">{children}</main>
        <Footer />
        <ServiceUpdates />
          <MobileNavigation />
        </AccountSessionProvider>
      </body>
    </html>
  );
}
