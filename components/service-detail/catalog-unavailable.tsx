import Link from "next/link";
import { RefreshCw } from "lucide-react";

export function CatalogUnavailable() {
  return <section className="mx-auto my-16 max-w-xl rounded-2xl border border-zinc-200 bg-white px-6 py-14 text-center"><RefreshCw className="mx-auto h-7 w-7 text-violet-600" /><h1 className="mt-5 text-2xl font-semibold tracking-tight">We couldn’t load the services</h1><p className="mt-3 text-sm leading-6 text-zinc-500">Please try again in a moment. Your existing bookings are still available from your account.</p><div className="mt-6 flex justify-center gap-3"><a href="" className="rounded-lg bg-zinc-950 px-4 py-3 text-xs font-semibold text-white">Try again</a><Link href="/bookings" className="rounded-lg border border-zinc-200 px-4 py-3 text-xs font-semibold">My bookings</Link></div></section>;
}
