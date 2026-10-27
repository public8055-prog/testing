import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

export function Stars({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
      <span className="text-sm font-bold text-zinc-900">{value.toFixed(2)}</span>
    </span>
  );
}

export function SectionHead({
  eyebrow,
  title,
  sub,
  action,
}: {
  eyebrow?: string;
  title: string;
  sub?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        {eyebrow && (
          <p className="mb-1 text-xs font-bold uppercase tracking-[0.18em] text-violet-600">
            {eyebrow}
          </p>
        )}
        <h2 className="text-2xl font-extrabold tracking-tight text-zinc-900 sm:text-3xl">
          {title}
        </h2>
        {sub && <p className="mt-1 max-w-xl text-sm text-zinc-500">{sub}</p>}
      </div>
      {action}
    </div>
  );
}
