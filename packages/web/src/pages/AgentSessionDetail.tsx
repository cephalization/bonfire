import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getAgentSession, retryAgentSession, type AgentSession, BonfireAPIError } from "@/lib/api";

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getStatusBadgeVariant(status: AgentSession["status"]) {
  switch (status) {
    case "ready":
      return "default";
    case "creating":
      return "secondary";
    case "error":
      return "destructive";
    case "archived":
      return "outline";
    default:
      return "secondary";
  }
}

export function AgentSessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [session, setSession] = useState<AgentSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRetrying, setIsRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSession = useCallback(async () => {
    if (!id) return;

    try {
      setIsLoading(true);
      setError(null);
      const data = await getAgentSession(id);
      setSession(data);
    } catch (err) {
      const message =
        err instanceof BonfireAPIError ? err.message : "Failed to fetch session. Please try again.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  // Poll for updates while session is creating
  useEffect(() => {
    if (!session || session.status !== "creating") return;

    const interval = setInterval(() => {
      fetchSession();
    }, 3000);

    return () => clearInterval(interval);
  }, [session, fetchSession]);

  const handleRetry = async () => {
    if (!id) return;

    setIsRetrying(true);
    try {
      await retryAgentSession(id);
      await fetchSession();
    } catch (err) {
      const message = err instanceof BonfireAPIError ? err.message : "Failed to retry session";
      setError(message);
    } finally {
      setIsRetrying(false);
    }
  };

  if (isLoading) {
    return (
      <div
        className="flex min-h-[50vh] flex-col items-center justify-center"
        data-testid="detail-loading"
      >
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
        <p className="mt-4 text-sm text-muted-foreground">Loading session...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" asChild className="min-h-[44px]">
          <Link to="/agent/sessions">
            <ArrowLeft className="mr-2 size-4" />
            Back to Sessions
          </Link>
        </Button>

        <div
          className="flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive"
          data-testid="detail-error"
        >
          <AlertCircle className="mt-0.5 size-5 shrink-0" />
          <div className="flex-1">
            <p className="font-medium">Error</p>
            <p className="text-sm">{error}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={fetchSession} className="shrink-0">
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" asChild className="min-h-[44px]">
          <Link to="/agent/sessions">
            <ArrowLeft className="mr-2 size-4" />
            Back to Sessions
          </Link>
        </Button>

        <div className="flex min-h-[50vh] flex-col items-center justify-center">
          <h2 className="text-xl font-semibold">Session not found</h2>
          <p className="mt-2 text-muted-foreground">
            The session you&apos;re looking for doesn&apos;t exist.
          </p>
          <Button asChild className="mt-4">
            <Link to="/agent/sessions">View All Sessions</Link>
          </Button>
        </div>
      </div>
    );
  }

  const isReady = session.status === "ready";
  const isError = session.status === "error";
  const isCreating = session.status === "creating";

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-4">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Button variant="ghost" size="sm" asChild className="min-h-[44px] -ml-2">
            <Link to="/agent/sessions">
              <ArrowLeft className="mr-2 size-4" />
              Back to Sessions
            </Link>
          </Button>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight" data-testid="session-title">
              {session.title || "Untitled Session"}
            </h1>
            <Badge variant={getStatusBadgeVariant(session.status)} data-testid="session-status">
              {session.status}
            </Badge>
          </div>
          <div className="text-sm text-muted-foreground space-y-1">
            <p data-testid="session-repo">{session.repoUrl}</p>
            {session.branch && <p data-testid="session-branch">Branch: {session.branch}</p>}
            <p data-testid="session-created">Created {formatDate(session.createdAt)}</p>
          </div>
        </div>

        {isError && (
          <Button
            onClick={handleRetry}
            disabled={isRetrying}
            className="min-h-[44px]"
            data-testid="retry-btn"
          >
            <RefreshCw className={`mr-2 size-4 ${isRetrying ? "animate-spin" : ""}`} />
            Retry Bootstrap
          </Button>
        )}
      </div>

      {/* Error Message */}
      {session.errorMessage && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive">
          <p className="font-medium">Error</p>
          <p className="text-sm">{session.errorMessage}</p>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0">
        {isReady ? (
          <div className="h-full rounded-lg border bg-background overflow-hidden">
            <iframe
              src={`/api/agent/sessions/${session.id}/opencode/`}
              className="w-full h-full border-0"
              title={`Agent Session - ${session.title || session.id}`}
              data-testid="opencode-iframe"
              allow="clipboard-write"
            />
          </div>
        ) : isCreating ? (
          <div
            className="flex h-full flex-col items-center justify-center rounded-lg border border-dashed"
            data-testid="creating-state"
          >
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
            <p className="mt-4 text-sm text-muted-foreground">Creating session...</p>
            <p className="text-xs text-muted-foreground mt-1">
              This may take a few moments while we clone the repository and set up the environment.
            </p>
          </div>
        ) : isError ? (
          <div
            className="flex h-full flex-col items-center justify-center rounded-lg border border-dashed"
            data-testid="error-state"
          >
            <AlertCircle className="size-12 text-destructive" />
            <p className="mt-4 text-sm font-medium">Session failed to start</p>
            {session.errorMessage && (
              <p className="text-xs text-muted-foreground mt-1 max-w-md text-center">
                {session.errorMessage}
              </p>
            )}
            <Button onClick={handleRetry} disabled={isRetrying} className="mt-4">
              <RefreshCw className={`mr-2 size-4 ${isRetrying ? "animate-spin" : ""}`} />
              Retry
            </Button>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center rounded-lg border border-dashed">
            <p className="text-muted-foreground">This session is archived.</p>
            <Button variant="outline" asChild className="mt-4">
              <Link to="/agent/sessions">View Active Sessions</Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
