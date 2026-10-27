import Link from "next/link";
import { CalendarCheck, ChevronRight, Receipt } from "lucide-react";
import { readBookings } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { formatINR } from "@/lib/utils";
import { Card, Badge } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function BookingsPage() {
  const user=await getCurrentUser();
  if(!user)redirect("/account?next=/bookings");
  const bookings = await readBookings(user.id,100);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-violet-600">Your account</p>
      <h1 className="mt-1 text-3xl font-black tracking-tight">My bookings</h1>
      <p className="mt-1 text-sm text-zinc-500">Your upcoming visits and service history, all in one place.</p>

      {bookings.length === 0 ? (
        <Card className="mt-6 p-12 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-violet-100 text-violet-700"><CalendarCheck className="h-7 w-7" /></span>
          <p className="mt-3 text-lg font-extrabold">No bookings yet</p>
          <p className="text-sm text-zinc-500">Your confirmed orders will appear here</p>
          <Link href="/#categories"><Button variant="brand" className="mt-4">Book a service</Button></Link>
        </Card>
      ) : (
        <div className="mt-6 space-y-3">
          {bookings.map((b) => (
            <Link key={b.id} href={`/bookings/${b.id}`}>
              <Card className="flex items-center gap-4 p-4 transition hover:shadow-lg">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-zinc-900 text-white"><Receipt className="h-5 w-5" /></span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-extrabold">
                    <span className="min-w-0 break-all font-mono text-xs">{b.id}</span>
                    <Badge className="bg-emerald-100 text-emerald-700">{b.status}</Badge>
                  </p>
                  <p className="truncate text-sm text-zinc-500">
                    {b.items.map((i) => `${i.title} × ${i.qty}`).join(" · ")} — {b.date} · {b.slot}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-black">{formatINR(b.total)}</p>
                  <p className="flex items-center gap-1 text-xs font-bold text-violet-700">View <ChevronRight className="h-3.5 w-3.5" /></p>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
