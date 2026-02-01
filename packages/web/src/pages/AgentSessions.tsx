import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { Plus, Loader2, AlertCircle, Bot, ExternalLink, Archive, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NewAgentSessionModal } from "@/components/NewAgentSessionModal";
import {
  listAgentSessions,
  archiveAgentSession,
  retryAgentSession,
  type AgentSession,
  BonfireAPIError,
} from "@/lib/api";

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
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

interface AgentSessionCardProps {
  session: AgentSession;
  onArchive: (id: string) => void;
  onRetry: (id: string) => void;
  isLoading: boolean;
}

function AgentSessionCard({ session, onArchive, onRetry, isLoading }: AgentSessionCardProps) {
  return (
    <div
      className="flex flex-col gap-4 rounded-lg border bg-card p-4 text-card-foreground shadow-sm transition-colors hover:bg-accent/50"
      data-testid={`session-card-${session.id}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold truncate" data-testid="session-title">
            {session.title || "Untitled Session"}
          </h3>
          <p className="text-sm text-muted-foreground truncate" data-testid="session-repo">
            {session.repoUrl}
          </p>
        </div>
        <Badge variant={getStatusBadgeVariant(session.status)} data-testid="session-status">
          {session.status}
        </Badge>
      </div>

      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        <span>Updated {formatDate(session.updatedAt)}</span>
        {session.branch && <span className="text-xs">({session.branch})</span>}
      </div>

      {session.errorMessage && (
        <div className="text-sm text-destructive bg-destructive/10 rounded-md p-2">
          {session.errorMessage}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {session.status === "ready" && (
          <Button variant="outline" size="sm" asChild className="min-h-[36px]">
            <Link to={`/agent/sessions/${session.id}`} data-testid={`open-session-${session.id}`}>
              <ExternalLink className="mr-2 size-4" />
              Open
            </Link>
          </Button>
        )}

        {session.status === "error" && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onRetry(session.id)}
            disabled={isLoading}
            className="min-h-[36px]"
            data-testid={`retry-session-${session.id}`}
          >
            <RefreshCw className={`mr-2 size-4 ${isLoading ? "animate-spin" : ""}`} />
            Retry
          </Button>
        )}

        {session.status !== "archived" && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onArchive(session.id)}
            disabled={isLoading}
            className="min-h-[36px] text-muted-foreground hover:text-destructive"
            data-testid={`archive-session-${session.id}`}
          >
            <Archive className="mr-2 size-4" />
            Archive
          </Button>
        )}
      </div>
    </div>
  );
}

interface AgentSessionListProps {
  sessions: AgentSession[];
  onArchive: (id: string) => void;
  onRetry: (id: string) => void;
  isLoading: Record<string, boolean>;
}

function AgentSessionList({ sessions, onArchive, onRetry, isLoading }: AgentSessionListProps) {
  const activeSessions = sessions.filter((s) => s.status !== "archived");
  const archivedSessions = sessions.filter((s) => s.status === "archived");

  if (sessions.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center"
        data-testid="session-list-empty"
      >
        <div className="flex size-16 items-center justify-center rounded-full bg-muted">
          <Bot className="size-8 text-muted-foreground" />
        </div>
        <h3 className="mt-4 text-lg font-semibold">No sessions yet</h3>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          Create your first agent session to get started with AI-powered development.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="session-list">
      {activeSessions.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {activeSessions.map((session) => (
            <AgentSessionCard
              key={session.id}
              session={session}
              onArchive={onArchive}
              onRetry={onRetry}
              isLoading={isLoading[session.id] || false}
            />
          ))}
        </div>
      )}

      {archivedSessions.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-muted-foreground">Archived</h3>
          <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3 opacity-60">
            {archivedSessions.map((session) => (
              <AgentSessionCard
                key={session.id}
                session={session}
                onArchive={onArchive}
                onRetry={onRetry}
                isLoading={isLoading[session.id] || false}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function AgentSessionsPage() {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  const fetchSessions = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await listAgentSessions();
      setSessions(data);
    } catch (err) {
      const message =
        err instanceof BonfireAPIError
          ? err.message
          : "Failed to fetch sessions. Please try again.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // Poll for updates when there are creating sessions
  useEffect(() => {
    const hasCreatingSessions = sessions.some((s) => s.status === "creating");
    if (!hasCreatingSessions) return;

    const interval = setInterval(() => {
      fetchSessions();
    }, 3000);

    return () => clearInterval(interval);
  }, [sessions, fetchSessions]);

  const handleArchive = async (id: string) => {
    setActionLoading((prev) => ({ ...prev, [id]: true }));
    try {
      await archiveAgentSession(id);
      await fetchSessions();
    } catch (err) {
      const message = err instanceof BonfireAPIError ? err.message : "Failed to archive session";
      setError(message);
    } finally {
      setActionLoading((prev) => ({ ...prev, [id]: false }));
    }
  };

  const handleRetry = async (id: string) => {
    setActionLoading((prev) => ({ ...prev, [id]: true }));
    try {
      await retryAgentSession(id);
      await fetchSessions();
    } catch (err) {
      const message = err instanceof BonfireAPIError ? err.message : "Failed to retry session";
      setError(message);
    } finally {
      setActionLoading((prev) => ({ ...prev, [id]: false }));
    }
  };

  const handleCreateSuccess = () => {
    fetchSessions();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Agent Sessions</h1>
          <p className="text-muted-foreground">Manage your AI-powered development environments</p>
        </div>
        <NewAgentSessionModal onSuccess={handleCreateSuccess}>
          <Button className="min-h-[44px] w-full sm:w-auto" data-testid="new-session-btn">
            <Plus className="mr-2 size-4" />
            New Session
          </Button>
        </NewAgentSessionModal>
      </div>

      {/* Error Alert */}
      {error && (
        <div
          className="flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive"
          data-testid="sessions-error"
        >
          <AlertCircle className="mt-0.5 size-5 shrink-0" />
          <div className="flex-1">
            <p className="font-medium">Error</p>
            <p className="text-sm">{error}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setError(null)} className="shrink-0">
            Dismiss
          </Button>
        </div>
      )}

      {/* Session List */}
      {isLoading ? (
        <div
          className="flex flex-col items-center justify-center py-12"
          data-testid="sessions-loading"
        >
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
          <p className="mt-4 text-sm text-muted-foreground">Loading sessions...</p>
        </div>
      ) : (
        <AgentSessionList
          sessions={sessions}
          onArchive={handleArchive}
          onRetry={handleRetry}
          isLoading={actionLoading}
        />
      )}
    </div>
  );
}
