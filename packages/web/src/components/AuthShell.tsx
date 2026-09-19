import { Flame } from "lucide-react";

/** Centered card used by the sign-in, sign-up and invitation pages. */
export function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2 text-center">
          <div className="flex items-center justify-center gap-2 text-lg font-semibold">
            <Flame className="size-6 text-primary" />
            <span>Bonfire</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {description && <p className="text-muted-foreground text-sm">{description}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive" role="alert">
      {message}
    </div>
  );
}
