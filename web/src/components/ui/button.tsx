import type { ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // One button system: 10px radius, a press that scales to 0.97, hover that
  // changes fill and shadow but never layout. Primary carries a faint inner
  // highlight and a soft drop so it reads as pressable on white paper.
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-[10px] font-medium tracking-[-0.01em] transition-[transform,background-color,box-shadow,color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:pointer-events-none disabled:opacity-40 active:scale-[0.97]",
  {
    variants: {
      variant: {
        primary:
          "bg-action text-primary-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_1px_2px_rgb(28_28_25/0.2),0_6px_16px_-6px_rgb(28_28_25/0.45)] hover:bg-action-hover hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_1px_2px_rgb(28_28_25/0.2),0_10px_22px_-6px_rgb(28_28_25/0.5)]",
        ghost:
          "bg-bg text-fg shadow-[inset_0_0_0_1px_var(--color-border),0_1px_2px_rgb(28_28_25/0.06)] hover:bg-surface hover:shadow-[inset_0_0_0_1px_#d3d2c8,0_1px_2px_rgb(28_28_25/0.08)]",
        subtle: "bg-raised text-fg hover:bg-[#e6e5dc]",
      },
      size: {
        sm: "h-9 px-3.5 text-sm",
        md: "h-11 px-5 text-[15px]",
        lg: "h-12 px-6 text-[15.5px]",
        icon: "size-11",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export function Button({
  className,
  variant,
  size,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
