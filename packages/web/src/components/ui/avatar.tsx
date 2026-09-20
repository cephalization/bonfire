/**
 * A minimal avatar: initials on a tinted circle. Kept dependency-free (no
 * Radix Avatar) because Bonfire has no profile images yet.
 */

import * as React from "react";
import { cn } from "@/lib/utils";

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function Avatar({
  className,
  name,
  children,
  ...props
}: React.ComponentProps<"div"> & { name?: string }) {
  return (
    <div
      data-slot="avatar"
      role="img"
      aria-label={name}
      className={cn(
        "flex size-8 shrink-0 select-none items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground",
        className
      )}
      {...props}
    >
      {children ?? (name ? initialsOf(name) : null)}
    </div>
  );
}

export { Avatar };
