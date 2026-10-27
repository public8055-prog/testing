import { paymentConfig } from "@/lib/payment-router";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(paymentConfig(), { headers: { "Cache-Control": "no-store" } });
}
