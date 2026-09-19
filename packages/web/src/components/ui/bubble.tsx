/**
 * Bubble — the surface of a message. Ported from shadcn/ui's June 2026 chat
 * components; the variant styles are written out here because the registry's
 * `cn-*` style layer is not part of this project.
 * See https://ui.shadcn.com/docs/components/bubble
 */

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";

function BubbleGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="bubble-group"
      className={cn("flex min-w-0 flex-col gap-1", className)}
      {...props}
    />
  );
}

const bubbleVariants = cva(
  "group/bubble relative flex w-fit min-w-0 max-w-[80%] flex-col rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        muted: "bg-muted text-muted-foreground",
        tinted: "bg-primary/10 text-foreground",
        outline: "border border-border bg-background text-foreground",
        ghost: "max-w-full bg-transparent px-0 py-0 text-foreground",
        destructive: "border border-destructive/30 bg-destructive/10 text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

function Bubble({
  variant = "default",
  align = "start",
  className,
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof bubbleVariants> & {
    align?: "start" | "end";
  }) {
  return (
    <div
      data-slot="bubble"
      data-variant={variant}
      data-align={align}
      className={cn(bubbleVariants({ variant }), align === "end" && "self-end", className)}
      {...props}
    />
  );
}

function BubbleContent({
  asChild = false,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  asChild?: boolean;
}) {
  const Comp = asChild ? Slot : "div";

  return (
    <Comp
      data-slot="bubble-content"
      className={cn(
        "w-fit max-w-full min-w-0 overflow-hidden whitespace-pre-wrap wrap-break-word [button]:text-left [button,a]:transition-colors",
        className
      )}
      {...props}
    />
  );
}

const bubbleReactionsVariants = cva(
  "absolute z-10 flex w-fit items-center justify-center gap-0.5 rounded-full border border-border bg-background px-1.5 py-0.5 text-xs shadow-sm",
  {
    variants: {
      side: {
        top: "-top-3",
        bottom: "-bottom-3",
      },
      align: {
        start: "left-2",
        end: "right-2",
      },
    },
    defaultVariants: {
      side: "bottom",
      align: "end",
    },
  }
);

function BubbleReactions({
  side = "bottom",
  align = "end",
  className,
  ...props
}: React.ComponentProps<"div"> & {
  align?: "start" | "end";
  side?: "top" | "bottom";
}) {
  return (
    <div
      data-slot="bubble-reactions"
      data-align={align}
      data-side={side}
      className={cn(bubbleReactionsVariants({ side, align }), className)}
      {...props}
    />
  );
}

export { BubbleGroup, Bubble, BubbleContent, BubbleReactions, bubbleVariants };
