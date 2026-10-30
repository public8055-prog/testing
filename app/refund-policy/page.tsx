import type { Metadata } from "next";
import { PolicyContent } from "@/components/site/policies";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Cancellations & refunds | SanjuNow", description: "Cancellation windows, refund handling and support for catalogue services and individual provider bookings." };

export default function RefundPolicyPage() {
  return <div className="bg-white text-[#162f39]">
    <section className="info-hero"><div className="uk-shell"><p className="eyebrow">CLEAR TERMS BEFORE YOU BOOK</p><h1>Cancellations & refunds</h1><p>Understand the cancellation window, payment handling and how to get help with a service concern.</p></div></section>
    <PolicyContent kind="refund" />
  </div>;
}
