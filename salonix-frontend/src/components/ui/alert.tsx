import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const alertVariants = cva("relative w-full rounded-lg border px-4 py-3 text-sm", {
  variants: {
    variant: {
      error: "border-state-error-border bg-state-error-bg text-state-error",
      success: "border-[var(--state-success-border)] bg-[var(--state-success-bg)] text-[var(--state-success-text)]",
      warning: "border-[var(--state-warning-border)] bg-[var(--state-warning-bg)] text-[var(--state-warning-text)]",
      info: "border-[var(--state-info-border)] bg-[var(--state-info-bg)] text-[var(--state-info-text)]",
    },
  },
  defaultVariants: { variant: "error" },
});

function Alert({ className, variant, ...props }: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return <div role="alert" data-slot="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="alert-description" className={cn("text-sm", className)} {...props} />;
}

export { Alert, AlertDescription, alertVariants };
