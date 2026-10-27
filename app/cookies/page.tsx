import type { Metadata } from "next";
import { PolicyContent } from "@/components/site/policies";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Cookies & browser storage | UrbanKare", description: "How UrbanKare uses essential sign-in and cart storage, external images and payment services." };

export default function CookiesPage() {
  return <div className="bg-white text-[#162f39]">
    <section className="info-hero"><div className="uk-shell"><p className="eyebrow">YOUR BROWSER, YOUR CHOICES</p><h1>Cookies & browser storage</h1><p>What stays in your browser, why it is used and how you can control it.</p></div></section>
    <PolicyContent kind="cookies" />
  </div>;
}
