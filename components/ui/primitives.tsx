import { cn } from "@/lib/utils";

export function Badge({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide",
        className ?? "bg-zinc-900 text-white"
      )}
    >
      {children}
    </span>
  );
}

export function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-zinc-200/80 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]",
        className
      )}
    >
      {children}
    </div>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={
        "flex h-11 w-full rounded-xl border border-zinc-200 bg-white px-4 text-base sm:text-sm outline-none transition placeholder:text-zinc-500 focus:border-violet-500 focus:ring-4 focus:ring-violet-500/10 " +
        (props.className ?? "")
      }
    />
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={
        "flex min-h-[90px] w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-base sm:text-sm outline-none transition placeholder:text-zinc-500 focus:border-violet-500 focus:ring-4 focus:ring-violet-500/10 " +
        (props.className ?? "")
      }
    />
  );
}

export function Separator({ className }: { className?: string }) {
  return <div className={"h-px w-full bg-zinc-100 " + (className ?? "")} />;
}
