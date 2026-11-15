"use client";

import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: ReactNode;
}

interface SegmentedControlProps<T extends string> {
  "aria-label": string;
  className?: string;
  onValueChange: (value: T) => void;
  options: readonly [SegmentedControlOption<T>, ...SegmentedControlOption<T>[]];
  value: T;
}

export function SegmentedControl<T extends string>({
  "aria-label": ariaLabel,
  className,
  onValueChange,
  options,
  value,
}: SegmentedControlProps<T>) {
  const prefersReducedMotion = useReducedMotion();
  const selectedIndex = options.findIndex((option) => option.value === value);

  return (
    <div
      aria-label={ariaLabel}
      className={cn(
        "relative grid rounded-full border border-border-default bg-surface-muted p-1",
        className,
      )}
      role="group"
      style={{
        gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
      }}
    >
      {selectedIndex >= 0 && (
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-1 left-1 rounded-full bg-action-primary"
          initial={false}
          animate={{ x: `${selectedIndex * 100}%` }}
          style={{
            width: `calc((100% - 0.5rem) / ${options.length})`,
          }}
          transition={
            prefersReducedMotion
              ? { duration: 0 }
              : {
                  type: "tween",
                  duration: 0.35,
                  ease: [0.4, 0, 0.2, 1],
                }
          }
        />
      )}

      {options.map((option, index) => {
        const isSelected = option.value === value;

        return (
          <Button
            key={option.value}
            aria-pressed={isSelected}
            className={cn(
              "relative z-10 row-start-1 rounded-full",
              isSelected ? "text-primary-foreground" : "text-text-muted",
            )}
            onClick={() => onValueChange(option.value)}
            style={{ gridColumn: index + 1 }}
            type="button"
            variant="ghost"
          >
            {option.label}
          </Button>
        );
      })}
    </div>
  );
}
