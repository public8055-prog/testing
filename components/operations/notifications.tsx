"use client";
import { sessionFetch } from "@/lib/session-client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, Bell, CheckCheck, Send } from "lucide-react";
import type { ServiceUpdate } from "@/lib/service-operations";
import { EmptyState, PageHeading } from "@/components/platform/shell";
import styles from "./workspace.module.css";
export function NotificationsWorkspace({ initial }: { initial: { notifications: ServiceUpdate[]; unread: number } }) {
  const [data, setData] = useState(initial), [error, setError] = useState("");
  const refresh = useCallback(async () => { try { const r = await sessionFetch("/api/notifications", { cache: "no-store" }); if (!r.ok) throw new Error(); setData(await r.json()); } catch { setError("Updates could not refresh. Please try again."); } }, []);
  useEffect(() => { const update = () => { void refresh(); }; window.addEventListener("urbankare:service-update", update); return () => window.removeEventListener("urbankare:service-update", update); }, [refresh]);
  async function read(id: string) { setError(""); try { const r = await sessionFetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action: "read" }) }); if (!r.ok) throw new Error(); await refresh(); window.dispatchEvent(new Event("urbankare:inbox-change")); } catch { setError("This update could not be marked as read."); } }
  return <div className={styles.workspace}><PageHeading eyebrow="Your inbox" title="A little clarity, delivered" description="Service updates and follow-ups from the team, with a permanent record you can revisit."/>{error && <p role="alert" className={styles.error}>{error}</p>}<div className={styles.inboxHeading}><span><Bell size={17}/>{data.unread} unread updates</span><button className={styles.secondary} onClick={() => void refresh()}>Refresh</button></div>{!data.notifications.length ? <EmptyState title="You’re all caught up" description="When the team sends an update about your service, it will appear here." href="/dashboard/tracking" label="View service activity"/> : <div className={styles.cards}>{data.notifications.map(n => <article className={styles.notification} data-unread={!n.read_at} key={n.id}><div><span className={styles.notificationIcon}><Bell size={19}/></span><div><time>{new Date(n.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })} IST</time><h2>{n.title}</h2>{n.token && <small className={styles.token}>{n.token}</small>}<p>{n.message}</p><div className={styles.cardActions}><Link className={styles.textButton} href={n.href} onClick={() => void read(n.id)}>View service <ArrowUpRight size={15}/></Link>{!n.read_at && <button className={styles.textButton} onClick={() => void read(n.id)}><CheckCheck size={16}/> Mark as read</button>}</div></div></div></article>)}</div>}</div>;
}
export function NotificationComposer({customers,services=[]}:{customers:{id:string;name:string;email:string}[];services?:{id:string;title:string}[]}){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState(""),[target,setTarget]=useState("user");
 const request=useRef<{payload:string;key:string}|null>(null);
 return <div className={styles.workspace}><PageHeading eyebrow="Customer communication" title="Keep your customers informed" description="Send a saved inbox update to one person, customers of a service, or all accounts."/><form className={styles.composer} onSubmit={async event=>{
  event.preventDefault();const form=event.currentTarget,values=new FormData(form);setBusy(true);setError("");setMessage("");
  try{
   const payload={target,title:values.get("title"),message:values.get("message"),...(target==="user"?{customerId:values.get("customer")}:target==="service"?{serviceId:values.get("service")}: {})};
   const encoded=JSON.stringify(payload);if(request.current?.payload!==encoded)request.current={payload:encoded,key:crypto.randomUUID()};
   const response=await sessionFetch("/api/notifications",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...payload,requestKey:request.current.key})}),result=await response.json();
   if(!response.ok)throw new Error(result.error||"Unable to send this notification.");
   setMessage(result.complete?`Notification saved to ${result.delivered} inbox${result.delivered===1?"":"es"}.`:"Notification saved. Delivery to the remaining inboxes continues in the background.");request.current=null;form.reset();
  }catch(reason){setError(reason instanceof Error?reason.message:"Unable to send this notification.");}finally{setBusy(false);}
 }}>
  <label>Audience<select value={target} onChange={event=>setTarget(event.target.value)}><option value="user">One customer</option><option value="service">Customers of a service</option><option value="all">All accounts</option></select></label>
  {target==="user"&&<label>Customer<select name="customer" required defaultValue=""><option value="" disabled>Select a customer</option>{customers.map(customer=><option key={customer.id} value={customer.id}>{customer.name} · {customer.email}</option>)}</select></label>}
  {target==="service"&&<label>Service<select name="service" required defaultValue=""><option value="" disabled>Select a service</option>{services.map(service=><option key={service.id} value={service.id}>{service.title}</option>)}</select></label>}
  <label>Title<input name="title" required minLength={3} maxLength={100} placeholder="A quick update on your service"/></label><label>Message<textarea name="message" required minLength={5} maxLength={1500} rows={5} placeholder="Explain what has changed and what the customer can expect next."/></label>
  <div className={styles.note}><Bell size={18}/><p>{target==="all"?"Every existing account receives this notification. Delivery is saved and resumes after interruptions.":target==="service"?"Customers with this service in any appointment or bundle receive one copy each.":"Only the selected customer receives this notification."}</p></div>
  {error&&<p role="alert" className={styles.error}>{error}</p>}{message&&<p role="status" className={styles.success}>{message}</p>}<button className={styles.primary} disabled={busy}><Send size={16}/>{busy?"Sending…":"Send notification"}</button>
 </form></div>;
}
