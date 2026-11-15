import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-10 w-full rounded-md border border-input-border bg-input-bg px-3 py-1 text-base text-[var(--input-text)] shadow-xs outline-none transition-[color,box-shadow] placeholder:text-[var(--input-placeholder)] hover:border-[var(--input-border-hover)] focus-visible:border-[var(--input-border-focus)] focus-visible:ring-[var(--input-focus-ring)] focus-visible:ring-[3px] disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-[var(--input-bg-disabled)] disabled:opacity-55 md:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
