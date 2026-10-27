"use client";
import Link from "next/link";
import {useState} from "react";
import {KeyRound} from "lucide-react";
import {PasswordField} from "./password-field";

export function PasswordResetForm({token,configured}:{token?:string;configured:boolean}){
 const[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
 const[codeStage,setCodeStage]=useState(false),[resetEmail,setResetEmail]=useState("");
 async function submit(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();setBusy(true);setError("");const fields=new FormData(event.currentTarget);
  try{
   if(token){
    const response=await fetch("/api/auth/password-reset",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({token,password:fields.get("password")})});
    const body=await response.json();if(!response.ok)throw new Error(body.error);setMessage(body.message);window.history.replaceState(null,"","/login/reset");
   }else if(!codeStage){
    const response=await fetch("/api/auth/password-reset",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:fields.get("email")})});
    const body=await response.json();if(!response.ok)throw new Error(body.error);setResetEmail(String(fields.get("email")||""));setCodeStage(true);
   }else{
    const response=await fetch("/api/auth/password-reset/confirm",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:resetEmail,code:fields.get("code"),password:fields.get("password")})});
    const body=await response.json();if(!response.ok)throw new Error(body.error);setMessage(body.message);setCodeStage(false);
   }
  }catch(error){setError(error instanceof Error?error.message:"Unable to continue.");}finally{setBusy(false);}
 }
 return <div className="mx-auto max-w-lg px-5 py-16"><div className="rounded-3xl border border-slate-200 bg-white p-8">
  <span className="mb-6 grid h-12 w-12 place-items-center rounded-2xl bg-teal-50 text-teal-700"><KeyRound size={23}/></span>
  <h1 className="text-2xl font-semibold tracking-tight text-[#142b3b]">{token?"Choose a new password":codeStage?"Check your email":"Forgot your password?"}</h1>
  <p className="mt-3 text-sm leading-6 text-slate-500">{token?"Your recovery link can be used once. Changing your password signs out all existing sessions.":codeStage?`We sent a 6-digit recovery code to ${resetEmail}. A reset link is in the same email as a backup. It expires after 10 minutes.`:configured?"Enter your account email. If an active account matches, we’ll send a 6-digit recovery code and a backup link by email.":"Password recovery is not available until the platform administrator connects email delivery. Contact your administrator for account assistance."}</p>
  {(configured||token)&&!(Boolean(message)&&!codeStage)&&<form className="mt-6 space-y-5" onSubmit={submit}>
   {token?<PasswordField label="New password" autoComplete="new-password" required minLength={10} maxLength={128}/>:
    !codeStage?<label className="block text-sm font-medium text-slate-600">Email address<input name="email" type="email" autoComplete="email" required maxLength={254} className="mt-2 h-12 w-full rounded-xl border border-slate-200 px-4"/></label>:
    <>
     <label className="block text-sm font-medium text-slate-600">6-digit recovery code<input name="code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" required maxLength={6} className="mt-2 h-12 w-full rounded-xl border border-slate-200 px-4" placeholder="123456"/></label>
     <PasswordField label="New password" autoComplete="new-password" required minLength={10} maxLength={128}/>
     {error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
     <p className="text-center text-xs text-slate-400">Wrong address? <button type="button" onClick={()=>{setCodeStage(false);setMessage("");}} className="font-medium text-teal-700">Change email address</button></p>
    </>}
   {!token&&!codeStage&&error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
   {token&&error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
   <button disabled={busy} className="w-full rounded-xl bg-[#142b3b] px-5 py-3.5 text-sm font-semibold text-white disabled:opacity-50">{busy?"Please wait…":token||codeStage?"Update password":"Send recovery code"}</button>
  </form>}
  {message&&<p role="status" className="mt-6 rounded-xl bg-teal-50 p-4 text-sm leading-6 text-teal-800">{message}</p>}
  <Link href="/login" className="mt-6 inline-block text-sm font-semibold text-teal-700">← Back to sign in</Link>
 </div></div>;
}