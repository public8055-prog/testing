import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] cursor-pointer",
  {
    variants: {
      variant: {
        default: "bg-zinc-900 text-white shadow hover:bg-zinc-800",
        brand: "bg-violet-600 text-white shadow-lg shadow-violet-600/25 hover:bg-violet-700",
        secondary: "bg-zinc-100 text-zinc-900 hover:bg-zinc-200",
        outline: "border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-900",
        ghost: "hover:bg-zinc-100 text-zinc-700",
        success: "bg-emerald-600 text-white hover:bg-emerald-700 shadow-lg shadow-emerald-600/25",
      },
      size: {
        default: "h-10 px-5 py-2",
        sm: "h-8 px-3 text-xs rounded-lg",
        lg: "h-12 px-8 text-base rounded-2xl",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
);
Button.displayName = "Button";

export { Button, buttonVariants };
