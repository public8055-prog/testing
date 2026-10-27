import { ResilientImage } from "@/components/ui/resilient-image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { PlatformBanner } from "@/lib/platform";

export function HomepageBanners({banners}:{banners:PlatformBanner[]}){
 if(!banners.length)return null;
 return <section aria-label="Featured services and announcements" className="mx-auto grid max-w-7xl gap-5 px-5 py-10 sm:grid-cols-2 lg:px-8">{banners.map(banner=><article key={banner.id} className="relative isolate overflow-hidden rounded-3xl bg-[#142b3b] text-white"><div className="grid h-full min-h-60 grid-cols-[1fr_36%]">
 <div className="relative z-10 flex flex-col items-start p-6 sm:p-8"><h2 className="text-xl font-semibold leading-tight sm:text-2xl">{banner.title}</h2>{banner.description&&<p className="mt-3 text-sm leading-6 text-slate-200">{banner.description}</p>}<Link href={banner.ctaPath} className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-[#142b3b]">{banner.ctaLabel}<ArrowUpRight size={16}/></Link></div>
 {/* External banner hosts are configured by trusted administrators and rendered as ordinary browser images. */}
 <ResilientImage src={banner.image} sizes="(max-width:639px) 36vw, 224px" alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full min-h-60 w-full object-cover opacity-80"/>
 </div></article>)}</section>;
}
