import { useEffect } from "react";
import { Navigate } from "react-router-dom";
import { authClient } from "@/lib/auth";
import { FullPageSpinner } from "@/components/RequireAuth";

/**
 * Pages that act on an organization need an active one on the session.
 *
 * A user with no memberships is sent to create an organization; a user with
 * memberships but nothing active gets their first one activated.
 */
export function RequireOrganization({ children }: { children: React.ReactNode }) {
  const { data: organizations, isPending: listPending } = authClient.useListOrganizations();
  const { data: active, isPending: activePending } = authClient.useActiveOrganization();

  const needsActivation =
    !listPending && !activePending && !active && (organizations?.length ?? 0) > 0;

  useEffect(() => {
    if (!needsActivation || !organizations) return;
    void authClient.organization.setActive({ organizationId: organizations[0].id });
  }, [needsActivation, organizations]);

  if (listPending || activePending) return <FullPageSpinner />;

  if (!active && (organizations?.length ?? 0) === 0) {
    return <Navigate to="/organizations/new" replace />;
  }

  if (!active) return <FullPageSpinner label="Selecting organization" />;

  return <>{children}</>;
}
