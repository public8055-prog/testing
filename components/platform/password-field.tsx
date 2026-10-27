"use client";
import {useId,useState,type InputHTMLAttributes} from "react";
import {Eye,EyeOff} from "lucide-react";

type Props=Omit<InputHTMLAttributes<HTMLInputElement>,"type"|"id"|"className">&{id?:string;label?:string;inputClassName?:string;labelClassName?:string};

/** Visibility is a deliberate local choice; the password value stays in the input. */
export function PasswordField({id,label="Password",inputClassName="mt-2 h-12 w-full rounded-xl border border-slate-200 px-4 font-normal",labelClassName="block text-sm font-medium text-slate-700",...props}:Props){
 const generatedId=useId(),inputId=id||generatedId,[visible,setVisible]=useState(false);
 return <div><label htmlFor={inputId} className={labelClassName}>{label}</label><div className="relative"><input {...props} id={inputId} name={props.name||"password"} type={visible?"text":"password"} className={`${inputClassName} pr-14`}/><button type="button" aria-label={visible?"Hide password":"Show password"} aria-controls={inputId} aria-pressed={visible} disabled={props.disabled} onClick={()=>setVisible(value=>!value)} className="absolute bottom-0 right-0 grid h-12 w-12 place-items-center rounded-xl text-slate-500 hover:text-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:opacity-50">{visible?<EyeOff size={18} aria-hidden="true"/>:<Eye size={18} aria-hidden="true"/>}</button></div></div>;
}
