import type { ReactNode } from "react";
import { CalendarDays, Clock3, LogIn, LogOut, UserRound } from "lucide-react";
import type { Shift, Worker } from "@/lib/workforce";

type Props = {
  shifts:Shift[];
  controls:boolean;
  format:(iso:string|null,withDate?:boolean)=>string;
  hours:(shift:Shift)=>number;
  badge:(shift:Shift)=>ReactNode;
  actions:(shift:Shift)=>ReactNode;
};

export function ShiftRecords({shifts,controls,format,hours,badge,actions}:Props) {
  return <>
    <div className="divide-y divide-slate-100 lg:hidden">
      {shifts.map(shift=><article key={shift.id} aria-label={`${shift.name} shift`} className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-800"><UserRound size={20} strokeWidth={1.8}/></span>
            <div className="min-w-0"><h3 className="break-words text-sm font-semibold text-slate-900">{shift.name}</h3><p className="mt-1 break-words text-xs text-slate-500">{shift.department||shift.service||"Team member"}</p></div>
          </div>
          {badge(shift)}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-slate-600"><CalendarDays aria-hidden="true" size={15} className="shrink-0 text-slate-400"/><span>{format(shift.starts_at,true)} – {format(shift.ends_at)}</span></div>
        <dl className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3">
          <div><dt className="flex items-center gap-1.5 text-[10px] text-slate-500"><LogIn aria-hidden="true" size={12}/>Check in</dt><dd className="mt-1.5 text-xs font-semibold text-slate-800">{format(shift.check_in)}</dd></div>
          <div><dt className="flex items-center gap-1.5 text-[10px] text-slate-500"><LogOut aria-hidden="true" size={12}/>Check out</dt><dd className="mt-1.5 text-xs font-semibold text-slate-800">{format(shift.check_out)}</dd></div>
          <div><dt className="flex items-center gap-1.5 text-[10px] text-slate-500"><Clock3 aria-hidden="true" size={12}/>Recorded</dt><dd className="mt-1.5 text-xs font-semibold text-slate-800">{hours(shift).toFixed(1)} h</dd></div>
        </dl>
        {shift.notes&&<p className="mt-3 break-words text-xs leading-5 text-slate-500">{shift.notes}</p>}
        {controls&&<div className="mt-4 border-t border-slate-100 pt-3">{actions(shift)}</div>}
      </article>)}
    </div>
    <div className="hidden max-w-full overflow-x-auto lg:block"><table className="w-full text-left text-sm"><thead className="bg-slate-50/80 text-[10px] uppercase tracking-wider text-slate-500"><tr>{["Team member","Shift","Check-in / out","Hours","Status",...(controls?["Actions"]:[])].map(heading=><th key={heading} scope="col" className="whitespace-nowrap px-5 py-3.5 font-semibold">{heading}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{shifts.map(shift=><tr key={shift.id} className="hover:bg-slate-50/50">
      <td className="px-5 py-4"><div className="flex items-center gap-3"><span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#eef3f3] text-xs font-semibold text-teal-800">{shift.name.split(" ").map(name=>name[0]).slice(0,2).join("")}</span><div className="whitespace-nowrap font-medium text-slate-800">{shift.name}<div className="mt-1 text-xs font-normal text-slate-400">{shift.department||shift.service||"Team member"}</div></div></div></td>
      <td className="whitespace-nowrap px-5 py-4 text-xs text-slate-600">{format(shift.starts_at,true)}<div className="mt-1 text-slate-400">to {format(shift.ends_at)}</div></td>
      <td className="whitespace-nowrap px-5 py-4 text-xs text-slate-600">{format(shift.check_in)} / {format(shift.check_out)}</td>
      <td className="px-5 py-4 font-medium text-slate-700">{hours(shift).toFixed(1)}<span className="text-xs font-normal text-slate-400"> h</span></td>
      <td className="px-5 py-4">{badge(shift)}</td>{controls&&<td className="px-5 py-4">{actions(shift)}</td>}
    </tr>)}</tbody></table></div>
  </>;
}

export function TimesheetSummary({workers,shifts,hours}:{workers:Worker[];shifts:Shift[];hours:(shift:Shift)=>number}) {
  const records=workers.map(worker=>{
    const assigned=shifts.filter(shift=>shift.worker_id===worker.id&&shift.status==="scheduled");
    return {id:worker.id,name:worker.name,count:assigned.length,scheduled:assigned.reduce((total,shift)=>total+(Date.parse(shift.ends_at)-Date.parse(shift.starts_at))/3600000,0),recorded:assigned.reduce((total,shift)=>total+hours(shift),0),missing:assigned.filter(shift=>Date.parse(shift.ends_at)<Date.now()&&(!shift.check_in||!shift.check_out)).length};
  });
  return <>
    <div className="mt-5 space-y-3 md:hidden">{records.map(row=><article key={row.id} className="rounded-xl border border-slate-200 p-4"><div className="flex items-start justify-between gap-3"><h3 className="break-words text-sm font-semibold text-slate-900">{row.name}</h3><span className="shrink-0 text-xs text-slate-500">{row.count} {row.count===1?"shift":"shifts"}</span></div><dl className="mt-4 grid grid-cols-3 gap-2"><div><dt className="text-[10px] text-slate-500">Scheduled</dt><dd className="mt-1 text-sm font-semibold text-slate-700">{row.scheduled.toFixed(1)} h</dd></div><div><dt className="text-[10px] text-slate-500">Recorded</dt><dd className="mt-1 text-sm font-semibold text-teal-700">{row.recorded.toFixed(1)} h</dd></div><div><dt className="text-[10px] text-slate-500">Missing entries</dt><dd className={`mt-1 text-sm font-semibold ${row.missing?"text-amber-700":"text-slate-700"}`}>{row.missing}</dd></div></dl></article>)}</div>
    <div className="mt-5 hidden max-w-full overflow-x-auto md:block"><table className="w-full text-left text-sm"><thead className="border-b border-slate-100 text-xs text-slate-400"><tr>{["Team member","Shifts","Scheduled","Recorded","Missing entries"].map(heading=><th scope="col" className="whitespace-nowrap px-3 py-3 font-medium" key={heading}>{heading}</th>)}</tr></thead><tbody>{records.map(row=><tr key={row.id} className="border-b border-slate-50"><td className="px-3 py-4 font-medium text-slate-800">{row.name}</td><td className="px-3 py-4">{row.count}</td><td className="whitespace-nowrap px-3 py-4">{row.scheduled.toFixed(1)} h</td><td className="whitespace-nowrap px-3 py-4 font-semibold text-teal-700">{row.recorded.toFixed(1)} h</td><td className="px-3 py-4">{row.missing}</td></tr>)}</tbody></table></div>
  </>;
}
