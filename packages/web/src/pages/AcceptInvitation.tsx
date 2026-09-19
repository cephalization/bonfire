import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AuthShell, FormError } from "@/components/AuthShell";
import { FullPageSpinner } from "@/components/RequireAuth";
import { authClient, useSession, authErrorMessage } from "@/lib/auth";

interface InvitationView {
  id: string;
  email: string;
  role: string;
  organizationId: string;
  organizationName: string;
  inviterEmail: string;
  status: string;
}

/**
 * Landing page for an invitation link.
 *
 * Reading an invitation needs a session, so an anonymous visitor is asked to
 * sign in or sign up first and is brought back here afterwards.
 */
export function AcceptInvitation() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: session, isPending } = useSession();
  const [invitation, setInvitation] = useState<InvitationView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const here = `/invitations/${encodeURIComponent(id)}`;

  useEffect(() => {
    if (!session || !id) return;
    let cancelled = false;
    authClient.organization
      .getInvitation({ query: { id } })
      .then((result) => {
        if (cancelled) return;
        if (result.error || !result.data) {
          setError(authErrorMessage(result.error, "This invitation could not be loaded"));
        } else {
          setInvitation(result.data as InvitationView);
        }
      })
      .catch(() => !cancelled && setError("This invitation could not be loaded"));
    return () => {
      cancelled = true;
    };
  }, [session, id]);

  const respond = async (action: "accept" | "reject") => {
    setIsBusy(true);
    setError(null);
    try {
      const result =
        action === "accept"
          ? await authClient.organization.acceptInvitation({ invitationId: id })
          : await authClient.organization.rejectInvitation({ invitationId: id });
      if (result.error) {
        setError(authErrorMessage(result.error, `Could not ${action} the invitation`));
        return;
      }
      if (action === "accept" && invitation) {
        await authClient.organization.setActive({ organizationId: invitation.organizationId });
      }
      navigate("/", { replace: true });
    } finally {
      setIsBusy(false);
    }
  };

  if (isPending) return <FullPageSpinner />;

  if (!session) {
    const query = `?redirect=${encodeURIComponent(here)}`;
    return (
      <AuthShell
        title="You've been invited"
        description="Sign in, or create an account with the email address that was invited, to join the organization."
      >
        <div className="flex flex-col gap-2">
          <Button asChild>
            <Link to={`/signup${query}`}>Create an account</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to={`/login${query}`}>Sign in</Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  if (!invitation && !error) return <FullPageSpinner label="Loading invitation" />;

  if (invitation && invitation.status !== "pending") {
    return (
      <AuthShell title="Invitation no longer valid">
        <p className="text-center text-sm text-muted-foreground">
          This invitation has already been {invitation.status}.
        </p>
        <Button asChild className="w-full">
          <Link to="/">Go to the dashboard</Link>
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={invitation ? `Join ${invitation.organizationName}` : "Invitation"}
      description={
        invitation
          ? `${invitation.inviterEmail} invited ${invitation.email} to join as ${invitation.role}. You are signed in as ${session.user.email}.`
          : undefined
      }
    >
      <FormError message={error} />
      {invitation && (
        <div className="flex flex-col gap-2">
          <Button onClick={() => respond("accept")} disabled={isBusy} data-testid="accept-invite">
            {isBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Accept invitation
          </Button>
          <Button variant="outline" onClick={() => respond("reject")} disabled={isBusy}>
            Decline
          </Button>
        </div>
      )}
      {!invitation && (
        <Button asChild variant="outline" className="w-full">
          <Link to="/">Go to the dashboard</Link>
        </Button>
      )}
    </AuthShell>
  );
}
