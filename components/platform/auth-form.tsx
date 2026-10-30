"use client";
import Link from "next/link";
import { useHydrated } from "@/hooks/use-hydrated";
import { useState } from "react";
import { canonicalRole, isAdminRole } from "@/lib/roles";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { PasswordField } from "./password-field";
import { SignupConsent } from "./signup-consent";
import { ArrowRight,ShieldCheck,CalendarCheck,Check,MailCheck } from "lucide-react";

const inputClass="mt-2 h-12 w-full rounded-xl border border-slate-200 px-4 font-normal";

function finishSignIn(body:{user:{role:string}},returnPath:string){
  const defaultTarget=isAdminRole(body.user.role)?"/admin/dashboard":canonicalRole(body.user.role)==="PROVIDER"?"/provider/dashboard":"/dashboard";
  const requested=safeRedirectPath(returnPath,defaultTarget);
  const target=requested==="/dashboard"||(requested.startsWith("/admin")&&!isAdminRole(body.user.role))?defaultTarget:requested;
  window.dispatchEvent(new Event("urbankare:auth-changed"));
  window.location.replace(target);
}

function authenticationError(response: Response, message: string) {
  const seconds = Number(response.headers.get("Retry-After"));
  return response.status === 429 && Number.isFinite(seconds) && seconds > 0
    ? `${message} Try again in ${Math.ceil(seconds / 60)} minute${seconds > 60 ? "s" : ""}.`
    : message;
}

export function AuthForm({mode="login",next="/dashboard",otpConfigured=false}:{mode?:"login"|"register";next?:string;otpConfigured?:boolean}){
  const hydrated=useHydrated();
  const [error,setError]=useState("");const [busy,setBusy]=useState(false);const returnPath=safeRedirectPath(next);
  const [channel,setChannel]=useState<"password"|"code">("password");
  const [stage,setStage]=useState<"email"|"code">("email");const [sentTo,setSentTo]=useState("");const [notice,setNotice]=useState("");
  async function submit(e:React.FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);setError("");try{const form=Object.fromEntries(new FormData(e.currentTarget));const response=await fetch(`/api/auth/${mode}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...form,...(mode==="register"?{termsAccepted:form.policyConsent==="on",privacyConsent:form.policyConsent==="on",adultConfirmed:form.adultConfirmed==="on"}:{})})});const body=await response.json();if(!response.ok)throw new Error(authenticationError(response,body.error));if(mode==="register"){const email=String(form.email||"");if(body.verification){setSentTo(email);setStage("code");}else finishSignIn(body,returnPath);return;}finishSignIn(body,returnPath);}catch(e){setError(e instanceof Error?e.message:"Unable to continue. Please try again.");}finally{setBusy(false);}}
  async function requestCode(e:React.FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);setError("");setNotice("");try{const form=Object.fromEntries(new FormData(e.currentTarget));const response=await fetch("/api/auth/otp/request",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...form,purpose:"login"})});const body=await response.json();if(!response.ok)throw new Error(authenticationError(response,body.error));setSentTo(String(form.email||""));setStage("code");setNotice(`If an account exists for this address, a 6-digit code has been sent by email.`);}catch(e){setError(e instanceof Error?e.message:"Unable to continue. Please try again.");}finally{setBusy(false);}}
  async function resendCode(purpose:"login"|"verify"){setBusy(true);setError("");setNotice("");try{const response=await fetch("/api/auth/otp/request",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:sentTo,purpose})});const body=await response.json();if(!response.ok)throw new Error(authenticationError(response,body.error));setNotice("A new code has been sent by email. It replaces the previous one.");}catch(e){setError(e instanceof Error?e.message:"Unable to continue. Please try again.");}finally{setBusy(false);}}
  async function confirmCode(e:React.FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);setError("");try{const form=Object.fromEntries(new FormData(e.currentTarget));const response=await fetch("/api/auth/otp/verify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:sentTo,code:form.code,purpose:mode==="register"?"verify":"login"})});const body=await response.json();if(!response.ok)throw new Error(authenticationError(response,body.error));finishSignIn(body,returnPath);}catch(e){setError(e instanceof Error?e.message:"Unable to continue. Please try again.");}finally{setBusy(false);}}
  return <div className="mx-auto grid min-h-[75vh] max-w-6xl gap-12 px-5 py-14 lg:grid-cols-2 lg:items-center lg:gap-24">
    <div>
      <span className="inline-flex items-center gap-2 rounded-full bg-teal-50 px-4 py-2 text-xs font-semibold text-teal-800"><ShieldCheck size={15}/> One account. Everything organised.</span>
      <h1 className="mt-7 text-4xl font-semibold leading-[1.12] tracking-[-.045em] text-[#142b3b] sm:text-5xl">A little less to manage.<br/><span className="text-teal-700">A lot more peace of mind.</span></h1>
      <p className="mt-6 max-w-md text-base leading-7 text-slate-500">Your services, your people, and your everyday plans. Bring it all together with SanjuNow.</p>
      <div className="mt-8 space-y-4 text-sm text-slate-600">{["Book local professionals on your schedule","Keep your service history in one place","Manage your team and attendance"].map(item=><p key={item} className="flex items-center gap-3"><Check size={17} className="text-teal-600"/>{item}</p>)}</div>
    </div>
    <div className="rounded-3xl border border-slate-200 bg-white p-7 shadow-[0_12px_60px_-30px_#0f243a40] sm:p-10">
      <span className="mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-slate-50 text-[#142b3b]"><CalendarCheck size={24}/></span>
      <h2 className="text-2xl font-semibold tracking-tight text-[#142b3b]">{mode==="register"&&stage==="code"?"Check your inbox":mode==="register"?"Make yourself at home":stage==="code"?"Check your inbox":"Welcome back"}</h2>
      <p className="mt-2 text-sm text-slate-500">{mode==="register"&&stage==="code"?`We emailed a 6-digit code to ${sentTo}. Enter it to verify your email and remove this step.`:mode==="register"?"Create your account to get started.":stage==="code"?`We emailed a 6-digit code to ${sentTo}.`:"Sign in to pick up where you left off."}</p>
      {(mode==="register"?stage==="email":channel==="password")&&<form method="post" onSubmit={submit} className="mt-7 space-y-5">
        {mode==="register"&&<label className="block text-sm font-medium text-slate-700">Full name
          <input autoComplete="name" name="name" required minLength={2} maxLength={80} className={inputClass} placeholder="Your full name"/></label>}
        <label className="block text-sm font-medium text-slate-700">{mode==="register"?"Email address":"Email or login ID"}
          <input autoComplete={mode==="register"?"email":"username"} name="email" type={mode==="register"?"email":"text"} required maxLength={254} className={inputClass} placeholder={mode==="register"?"you@example.com":"Your email or login ID"}/></label>
        <PasswordField key={mode} autoComplete={mode==="register"?"new-password":"current-password"} required minLength={mode==="register"?10:1} maxLength={128} placeholder={mode==="register"?"At least 10 characters":"Your password"}/>
        {mode==="register"&&<SignupConsent/>}
        {notice&&<p className="rounded-xl bg-teal-50 p-3 text-sm text-teal-800">{notice}</p>}
        {error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <button disabled={busy||!hydrated} className="flex h-12 w-full items-center justify-center gap-3 rounded-xl bg-[#142b3b] font-semibold text-white transition hover:bg-teal-800 disabled:opacity-50">{busy?"Please wait…":mode==="register"?"Create account":"Sign in"}<ArrowRight size={17}/></button>
      </form>}
      {mode==="login"&&channel==="code"&&stage==="email"&&<form method="post" onSubmit={requestCode} className="mt-7 space-y-5">
        <label className="block text-sm font-medium text-slate-700">Email address
          <input autoComplete="email" name="email" type="email" required maxLength={254} className={inputClass} placeholder="you@example.com"/></label>
        {notice&&<p className="rounded-xl bg-teal-50 p-3 text-sm text-teal-800">{notice}</p>}
        {error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <button disabled={busy||!hydrated} className="flex h-12 w-full items-center justify-center gap-3 rounded-xl bg-[#142b3b] font-semibold text-white transition hover:bg-teal-800 disabled:opacity-50">{busy?"Sending…":"Email me a code"}<MailCheck size={17}/></button>
      </form>}
      {mode==="login"&&channel==="code"&&stage==="code"&&<form method="post" onSubmit={confirmCode} className="mt-7 space-y-5">
        <label className="block text-sm font-medium text-slate-700">6-digit code
          <input autoComplete="one-time-code" name="code" inputMode="numeric" pattern="[0-9]{6}" required maxLength={6} className={inputClass} placeholder="123456"/></label>
        {error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <button disabled={busy||!hydrated} className="flex h-12 w-full items-center justify-center gap-3 rounded-xl bg-[#142b3b] font-semibold text-white transition hover:bg-teal-800 disabled:opacity-50">{busy?"Verifying…":"Verify code"}<ArrowRight size={17}/></button>
      </form>}
      {mode==="register"&&stage==="code"&&<form method="post" onSubmit={confirmCode} className="mt-7 space-y-5">
        <label className="block text-sm font-medium text-slate-700">6-digit code
          <input autoComplete="one-time-code" name="code" inputMode="numeric" pattern="[0-9]{6}" required maxLength={6} className={inputClass} placeholder="123456"/></label>
        {notice&&<p className="rounded-xl bg-teal-50 p-3 text-sm text-teal-800">{notice}</p>}
        {error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <button disabled={busy||!hydrated} className="flex h-12 w-full items-center justify-center gap-3 rounded-xl bg-[#142b3b] font-semibold text-white transition hover:bg-teal-800 disabled:opacity-50">{busy?"Verifying…":"Verify email"}<ArrowRight size={17}/></button>
      </form>}
      {mode==="register"&&stage==="code"&&<p className="mt-4 text-center text-xs text-slate-400">Did not receive it? <button type="button" onClick={()=>resendCode("verify")} className="font-medium text-teal-700">Resend the code</button></p>}
      <p className="mt-6 text-center text-sm text-slate-500">{mode==="register"?"Already have an account?":"New to SanjuNow?"} <Link href={`/${mode==="register"?"login":"register"}?next=${encodeURIComponent(returnPath)}`} className="font-semibold text-teal-700">{mode==="register"?"Sign in":"Create an account"}</Link></p>
      {mode==="login"&&<div className="mt-5 border-t border-slate-100 pt-4 text-center text-xs leading-5 text-slate-400">
        {otpConfigured&&<button type="button" disabled={busy||!hydrated} onClick={()=>{setChannel(current=>current==="password"?"code":"password");setStage("email");setSentTo("");setError("");setNotice("");}} className="inline-flex min-h-11 items-center px-2 font-medium text-teal-700 disabled:opacity-50">{channel==="password"?"Sign in with an email code instead":"Use my password instead"}</button>}
        {otpConfigured&&channel==="code"&&stage==="code"&&<button type="button" onClick={()=>{setStage("email");setError("");setNotice("");}} className="font-medium text-teal-700">Send a new code</button>}
        {(!otpConfigured||channel==="password")&&<Link href="/login/reset" className="font-medium text-teal-700">Forgot your password?</Link>}
      </div>}
    </div>
  </div>;
}
