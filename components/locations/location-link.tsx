import Link from "next/link";
import {MapPin} from "lucide-react";
import {locationPageUrl} from "@/lib/location-types";
export function LocationLink({source,id}:{source:"catalog"|"provider";id:string}){return <Link href={locationPageUrl(source,id)} className="mt-3 inline-flex min-h-11 max-w-full items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium"><MapPin size={16} strokeWidth={1.75} aria-hidden="true"/>Address & live location</Link>;}
