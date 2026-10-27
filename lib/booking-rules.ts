import { z } from "zod";
export const SLOTS = ["09:00 AM", "11:00 AM", "01:00 PM", "03:00 PM", "05:00 PM", "07:00 PM"] as const;
export const cartItemsSchema=z.array(z.object({slug:z.string().min(1).max(100),qty:z.number().int().min(1).max(10)})).min(1).max(20).refine(items=>new Set(items.map(i=>i.slug)).size===items.length,"Duplicate services are not allowed.");
export function indiaDate(offset = 0) { return new Date(Date.now() + 19800000 + offset * 86400000).toISOString().slice(0,10); }
export function slotTimestamp(date:string,slot:string) {
  const [time,meridian]=slot.split(" "); const [h,m]=time.split(":").map(Number);
  const hour=h%12+(meridian==="PM"?12:0);
  return new Date(`${date}T${String(hour).padStart(2,"0")}:${String(m).padStart(2,"0")}:00+05:30`).getTime();
}
export function isBookableSlot(date:string,slot:string,durationMin=0) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<indiaDate()||date>indiaDate(30)||!SLOTS.includes(slot as typeof SLOTS[number]))return false;
  const start=slotTimestamp(date,slot);
  return Number.isFinite(start)&&new Date(`${date}T00:00:00Z`).toISOString().slice(0,10)===date&&start>=Date.now()+3600000&&start+durationMin*60000<=new Date(`${date}T21:00:00+05:30`).getTime();
}
export const checkoutSchema=z.object({
  items:cartItemsSchema,
  name:z.string().trim().min(2).max(80),phone:z.string().transform(v=>v.replace(/\s/g,"")).pipe(z.string().regex(/^[6-9]\d{9}$/)),
  address:z.string().trim().min(12).max(500).regex(/\b[1-9]\d{5}\b/,"Include a valid 6-digit pincode in your address."),date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),slot:z.enum(SLOTS),payment:z.enum(["upi","card","cash"]),
  expectedTotal:z.number().int().nonnegative().optional(),
}).superRefine((v,ctx)=>{
  if(v.date<indiaDate() || v.date>indiaDate(30) || !Number.isFinite(slotTimestamp(v.date,v.slot)) || new Date(`${v.date}T00:00:00Z`).toISOString().slice(0,10)!==v.date || slotTimestamp(v.date,v.slot)<Date.now()+3600000) ctx.addIssue({code:"custom",message:"Choose a valid slot at least one hour away, within the next 30 days.",path:["date"]});
  if(new Set(v.items.map(i=>i.slug)).size!==v.items.length) ctx.addIssue({code:"custom",message:"Duplicate services are not allowed.",path:["items"]});
});
export type CatalogPricingPolicy={discountPercent:number;visitFee:number;feeWaiverThreshold:number};
// These preserve the existing development catalogue policy; administrators configure the deployed policy.
export const DEFAULT_CATALOG_PRICING:CatalogPricingPolicy={discountPercent:10,visitFee:49,feeWaiverThreshold:999};
export function totals(items:{price:number;qty:number}[],policy:CatalogPricingPolicy=DEFAULT_CATALOG_PRICING) {
 const subtotal=items.reduce((sum,item)=>sum+item.price*item.qty,0); const discount=Math.round(subtotal*policy.discountPercent/100); const visitFee=subtotal>policy.feeWaiverThreshold||!subtotal?0:policy.visitFee;
 return {subtotal,discount,visitFee,total:subtotal-discount+visitFee};
}
