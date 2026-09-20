/**
 * Marker — status updates, system notes and labeled separators in a
 * conversation (tool activity, "thinking…", date breaks). Ported from
 * shadcn/ui's June 2026 chat components with the variant styles inlined.
 * See https://ui.shadcn.com/docs/components/marker
 */

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";

const markerVariants = cva(
  "group/marker relative flex w-full items-center gap-2 text-xs text-muted-foreground",
  {
    variants: {
      variant: {
        default: "py-1",
        separator:
          "justify-center py-2 before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border",
        border: "rounded-lg border border-border bg-muted/40 px-3 py-2",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

function Marker({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof markerVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "div";

  return (
    <Comp
      data-slot="marker"
      data-variant={variant}
      className={cn(markerVariants({ variant, className }))}
      {...props}
    />
  );
}

function MarkerIcon({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="marker-icon"
      aria-hidden="true"
      className={cn("inline-flex shrink-0 [&_svg]:size-3.5", className)}
      {...props}
    />
  );
}

function MarkerContent({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="marker-content"
      className={cn("min-w-0 wrap-break-word", className)}
      {...props}
    />
  );
}

export { Marker, MarkerIcon, MarkerContent, markerVariants };
