import { Loader2 } from "lucide-react";
import { Navigate, useLocation } from "react-router-dom";
import { useSession } from "@/lib/auth";

export function FullPageSpinner({ label }: { label?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center" role="status">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
      {label && <span className="ml-2 text-sm text-muted-foreground">{label}</span>}
    </div>
  );
}

/**
 * Gate for signed-in pages. Sends anonymous visitors to /login and brings
 * them back to where they were afterwards.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = useSession();
  const location = useLocation();

  if (isPending) return <FullPageSpinner />;

  if (!session) {
    const redirect = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?redirect=${encodeURIComponent(redirect)}`} replace />;
  }

  return <>{children}</>;
}

/** Read a `?redirect=` param, refusing anything that is not a local path. */
export function safeRedirect(search: string, fallback = "/"): string {
  const value = new URLSearchParams(search).get("redirect");
  if (value && value.startsWith("/") && !value.startsWith("//")) return value;
  return fallback;
}
