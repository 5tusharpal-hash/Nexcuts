import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
  {
    variants: {
      variant: {
        default: "bg-action-primary text-[var(--action-primary-text)] shadow-xs hover:bg-action-primary-hover active:bg-action-primary-active focus-visible:ring-[var(--action-primary-focus)]",
        destructive: "bg-action-danger text-text-inverse shadow-xs hover:bg-[var(--action-danger-hover)]",
        outline: "border border-border-primary bg-transparent text-[var(--text-secondary)] shadow-xs hover:bg-primary-50",
        secondary: "bg-action-secondary text-text-inverse shadow-xs hover:bg-[var(--action-secondary-hover)]",
        ghost: "text-[var(--text-secondary)] hover:bg-primary-50",
        link: "text-link underline-offset-4 hover:text-link-hover hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md gap-1.5 px-3",
        lg: "h-10 rounded-md px-6",
        icon: "size-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
