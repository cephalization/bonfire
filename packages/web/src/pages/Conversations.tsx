import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertCircle, Bot, Loader2, MessagesSquare, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  BonfireAPIError,
  createConversation,
  listConversations,
  type AgentStatus,
  type Conversation,
} from "@/lib/api";
import { authClient } from "@/lib/auth";
import { relativeTime } from "@/lib/time";

export function agentStatusLabel(status: AgentStatus): string {
  switch (status) {
    case "offline":
      return "No agent";
    case "provisioning":
      return "Starting agent";
    case "idle":
      return "Agent ready";
    case "busy":
      return "Agent working";
    case "error":
      return "Agent error";
  }
}

export function AgentStatusBadge({ status }: { status: AgentStatus }) {
  if (status === "offline") return null;
  const tone =
    status === "error"
      ? "border-destructive/40 text-destructive"
      : status === "busy" || status === "provisioning"
        ? "border-primary/40 text-primary"
        : "";
  return (
    <Badge variant="outline" className={`gap-1 ${tone}`}>
      <Bot className="size-3" />
      <span className={status === "busy" || status === "provisioning" ? "shimmer" : undefined}>
        {agentStatusLabel(status)}
      </span>
    </Badge>
  );
}

export function Conversations() {
  const navigate = useNavigate();
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id;

  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      setConversations(await listConversations(undefined, { organizationId }));
    } catch (err) {
      setError(err instanceof BonfireAPIError ? err.message : "Could not load conversations");
      setConversations([]);
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);
    setError(null);
    try {
      const created = await createConversation({
        title: title.trim() || undefined,
        organizationId,
      });
      navigate(`/conversations/${created.id}`);
    } catch (err) {
      setError(err instanceof BonfireAPIError ? err.message : "Could not start the conversation");
      setIsCreating(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Conversations</h1>
          <p className="text-sm text-muted-foreground">
            Group chats for your organization. Add an agent to any of them.
          </p>
        </div>
        <form onSubmit={create} className="flex gap-2">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="New conversation title"
            aria-label="New conversation title"
            className="sm:w-56"
          />
          <Button type="submit" disabled={isCreating}>
            {isCreating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            New
          </Button>
        </form>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="size-4" />
          {error}
        </div>
      )}

      {conversations === null ? (
        <div className="flex justify-center py-12">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : conversations.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-12 text-center">
          <MessagesSquare className="size-8 text-muted-foreground" />
          <p className="font-medium">No conversations yet</p>
          <p className="text-sm text-muted-foreground">
            Start one above. Everyone in the organization can join in.
          </p>
        </div>
      ) : (
        <ul className="divide-y rounded-lg border">
          {conversations.map((c) => (
            <li key={c.id}>
              <Link
                to={`/conversations/${c.id}`}
                className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{c.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.lastMessageAt
                      ? `Last message ${relativeTime(c.lastMessageAt)}`
                      : `Started ${relativeTime(c.createdAt)}`}
                  </p>
                </div>
                <AgentStatusBadge status={c.agentStatus} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
