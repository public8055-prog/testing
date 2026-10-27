"use client";
import { useEffect, useState } from "react";
import type { ServiceQuote } from "@/lib/quote";
export function useQuote(items:{slug:string;qty:number}[],date?:string){
 const key=JSON.stringify({items,date});
 const [result,setResult]=useState<{key:string;quote:ServiceQuote|null;error:string}>({key:"",quote:null,error:""});
 useEffect(()=>{
  if(!JSON.parse(key).items.length)return;
  const controller=new AbortController();
  const timer=setTimeout(()=>{fetch("/api/quote",{method:"POST",headers:{"Content-Type":"application/json"},body:key,signal:controller.signal}).then(async res=>{const body=await res.json();if(!res.ok)throw new Error(body.error||"Unable to check service prices.");setResult({key,quote:body,error:""});}).catch(e=>{if(!controller.signal.aborted)setResult({key,quote:null,error:e instanceof Error?e.message:"Unable to check service prices."});});},100);
  return()=>{clearTimeout(timer);controller.abort();};
 },[key]);
 const current=result.key===key&&items.length>0;
 return {quote:current?result.quote:null,error:current?result.error:"",loading:items.length>0&&!current};
}
