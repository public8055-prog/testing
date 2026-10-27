"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import type { AdminCategory } from "@/lib/platform";
import { sessionFetch } from "@/lib/session-client";
import { IdentityFields, identityFormValue } from "./identity-fields";
const field = "mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm";
export function AdminAddProvider({ categories }: { categories: AdminCategory[] }) {
  const [open,setOpen]=useState(false),[mode,setMode]=useState("existing"),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");const router=useRouter();
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();const form=event.currentTarget,data=new FormData(form);setBusy(true);setError("");setMessage("");
    try {
      const file=new FormData();file.set("purpose","provider-document");file.set("documentType","identity");file.set("file",data.get("file")!);
      const response=await sessionFetch("/api/uploads",{method:"POST",body:file}),upload=await response.json();if(!response.ok)throw new Error(upload.error);
      const profile:Record<string,unknown>={};for(const key of ["display_name","category","city","description","skills"])profile[key]=data.get(key);
      for(const key of ["experience","hourly_rate","daily_rate","monthly_rate","opening_hour","closing_hour"])profile[key]=Number(data.get(key));
      const saved=await sessionFetch("/api/admin/providers",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode,email:data.get("email"),...(mode==="new"?{initialPassword:data.get("initialPassword")} : {}),profile,uploadId:upload.id,identity:identityFormValue(data),consentReference:data.get("consentReference")})}),result=await saved.json();if(!saved.ok)throw new Error(result.error);
      form.reset();setOpen(false);setMessage("Vendor added. The identity photo and application are pending administrator approval. Give a new vendor their initial password privately; they can change it through Forgot password. No email was sent automatically.");router.refresh();
    }catch(reason){setError(reason instanceof Error?reason.message:"Could not add vendor.");}finally{setBusy(false);}
  }
  return <section className="mb-6 space-y-4"><button type="button" onClick={()=>setOpen(!open)} aria-expanded={open} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#142b3b] px-4 py-3 text-sm font-semibold text-white"><Plus size={17} aria-hidden="true"/>{open?"Close vendor form":"Add vendor"}</button>
    {error&&<p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p>}{message&&<p role="status" className="rounded-xl bg-teal-50 p-4 text-sm text-teal-900">{message}</p>}
    {open&&<form onSubmit={submit} className="grid min-w-0 gap-5 rounded-2xl border border-slate-200 bg-white p-5 sm:grid-cols-2"><h2 className="text-lg font-semibold sm:col-span-2">Add a vendor application</h2>
      <label className="text-sm">Account type<select value={mode} onChange={e=>setMode(e.target.value)} className={field}><option value="existing">Existing registered account</option><option value="new">Create new account</option></select></label>
      <label className="text-sm">Vendor email<input name="email" type="email" required maxLength={254} className={field}/></label>
      {mode==="new"&&<label className="text-sm sm:col-span-2">Initial account password<input name="initialPassword" type="password" autoComplete="new-password" required minLength={10} maxLength={128} className={field}/><span className="mt-2 block text-xs text-slate-600">Use a unique password and share it privately with the vendor. Existing passwords are never changed here.</span></label>}
      {[{name:"display_name",label:"Vendor display name",min:2,max:80},{name:"city",label:"City",min:2,max:80},{name:"skills",label:"Skills",min:3,max:300}].map(p=><label key={p.name} className="text-sm">{p.label}<input name={p.name} required minLength={p.min} maxLength={p.max} className={field}/></label>)}
      <label className="text-sm">Service category<select name="category" required className={field}><option value="">Select category</option>{categories.filter(c=>c.active!==false&&!c.archived).map(c=><option key={c.slug} value={c.slug}>{c.name}</option>)}</select></label>
      <label className="text-sm sm:col-span-2">Vendor description<textarea name="description" required minLength={30} maxLength={2000} rows={3} className={field}/></label>
      {[{name:"experience",label:"Experience (years)",min:0,max:60,value:0},{name:"hourly_rate",label:"Hourly rate (₹)",min:50,max:100000,value:100},{name:"daily_rate",label:"Daily rate (₹)",min:100,max:500000,value:800},{name:"monthly_rate",label:"Monthly rate (₹)",min:500,max:5000000,value:16000},{name:"opening_hour",label:"Opening hour (IST, 24 hour)",min:6,max:18,value:8},{name:"closing_hour",label:"Closing hour (IST, 24 hour)",min:7,max:22,value:18}].map(p=><label key={p.name} className="text-sm">{p.label}<input name={p.name} required type="number" min={p.min} max={p.max} defaultValue={p.value} className={field}/></label>)}
      <label className="min-w-0 text-sm sm:col-span-2">Identity photo<input name="file" type="file" required accept="image/jpeg,image/png,image/webp" className={`${field} max-w-full`} /></label>
      <IdentityFields administered/><label className="text-sm sm:col-span-2">Vendor permission reference<input name="consentReference" required minLength={8} maxLength={250} className={field}/><span className="mt-2 block text-xs text-slate-600">Record when/how permission was obtained. Do not enter an Aadhaar or other identity number.</span></label>
      <p className="text-sm text-slate-600 sm:col-span-2">Adding an application never approves or publishes it. Review the image and record the application decision separately.</p><button disabled={busy} className="min-h-11 rounded-xl bg-[#142b3b] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy?"Adding vendor…":"Create pending vendor"}</button>
    </form>}
  </section>;
}
