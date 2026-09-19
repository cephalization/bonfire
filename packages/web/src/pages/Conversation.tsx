import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  ChevronDown,
  Loader2,
  Send,
  Square,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Message, MessageAvatar, MessageContent, MessageHeader } from "@/components/ui/message";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import {
  attachAgent,
  BonfireAPIError,
  deleteConversation,
  detachAgent,
  getConversation,
  interruptAgent,
  listMessages,
  listVMs,
  postMessage,
  subscribeToConversation,
  type ConversationDetail,
  type ConversationMessage,
  type MessagePart,
  type VM,
} from "@/lib/api";
import { useSession } from "@/lib/auth";
import { timeOfDay } from "@/lib/time";
import { AgentStatusBadge } from "@/pages/Conversations";
import { cn } from "@/lib/utils";

/** Insert or replace a message, keeping the list ordered by creation time. */
export function upsertMessage(
  list: ConversationMessage[],
  message: ConversationMessage
): ConversationMessage[] {
  const index = list.findIndex((m) => m.id === message.id);
  if (index !== -1) {
    const next = list.slice();
    next[index] = message;
    return next;
  }
  const next = [...list, message];
  next.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return next;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof BonfireAPIError ? err.message : fallback;
}

export function Conversation() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data: session } = useSession();
  const me = session?.user.id;

  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [agentDialogOpen, setAgentDialogOpen] = useState(false);
  const [connected, setConnected] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const reloadConversation = useCallback(async () => {
    setConversation(await getConversation(id));
  }, [id]);

  // Initial load, then live updates over server-sent events.
  useEffect(() => {
    let cancelled = false;
    setConversation(null);
    setMessages([]);
    setLoadError(null);
    setConnected(false);

    (async () => {
      try {
        const [detail, history] = await Promise.all([getConversation(id), listMessages(id)]);
        if (cancelled) return;
        setConversation(detail);
        setMessages((current) => history.reduce(upsertMessage, current));
      } catch (err) {
        if (!cancelled) setLoadError(errorMessage(err, "Could not load the conversation"));
      }
    })();

    const unsubscribe = subscribeToConversation(
      id,
      (event) => {
        if (cancelled) return;
        switch (event.type) {
          case "ready":
            setConnected(true);
            break;
          case "message.created":
          case "message.updated":
            setMessages((current) => upsertMessage(current, event.message));
            break;
          case "conversation.updated":
            setConversation((current) => {
              if (!current) return current;
              const next = { ...current, ...event.conversation };
              // The VM name is only in the detail response.
              if (next.agentVmId !== current.agentVmId) void reloadConversation();
              return next;
            });
            break;
          case "participant.joined":
            void reloadConversation();
            break;
        }
      },
      { onError: () => setConnected(false) }
    );

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [id, reloadConversation]);

  const send = async () => {
    const body = draft.trim();
    if (!body || isSending) return;
    setIsSending(true);
    setActionError(null);
    try {
      const message = await postMessage(id, body);
      setMessages((current) => upsertMessage(current, message));
      setDraft("");
    } catch (err) {
      setActionError(errorMessage(err, "Could not send the message"));
    } finally {
      setIsSending(false);
      textareaRef.current?.focus();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  const runAction = async (action: () => Promise<unknown>, fallback: string) => {
    setActionError(null);
    try {
      await action();
    } catch (err) {
      setActionError(errorMessage(err, fallback));
    }
  };

  const remove = async () => {
    if (!window.confirm("Delete this conversation for everyone?")) return;
    await runAction(async () => {
      await deleteConversation(id);
      navigate("/conversations");
    }, "Could not delete the conversation");
  };

  const canDelete = useMemo(() => Boolean(conversation && me), [conversation, me]);

  if (loadError) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Link
          to="/conversations"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> All conversations
        </Link>
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="size-4" />
          {loadError}
        </div>
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const agentAttached = conversation.agentStatus !== "offline";

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-3xl flex-col gap-3">
      <header className="flex flex-wrap items-center gap-3">
        <Link
          to="/conversations"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          aria-label="All conversations"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">{conversation.title}</h1>
          <p className="truncate text-xs text-muted-foreground">
            {conversation.participants.map((p) => p.name).join(", ")}
            {conversation.agentVmName ? ` · agent in ${conversation.agentVmName}` : ""}
            {conversation.agentModel ? ` (${conversation.agentModel})` : ""}
            {!connected && " · reconnecting…"}
          </p>
        </div>
        <AgentStatusBadge status={conversation.agentStatus} />
        {agentAttached ? (
          <>
            {conversation.agentStatus === "busy" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => runAction(() => interruptAgent(id), "Could not stop the agent")}
              >
                <Square className="size-3.5" /> Stop
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => runAction(() => detachAgent(id), "Could not remove the agent")}
            >
              <X className="size-3.5" /> Remove agent
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setAgentDialogOpen(true)}>
            <Bot className="size-3.5" /> Add agent
          </Button>
        )}
        {canDelete && (
          <Button variant="ghost" size="icon-sm" onClick={remove} aria-label="Delete conversation">
            <Trash2 className="size-4" />
          </Button>
        )}
      </header>

      {conversation.agentStatus === "error" && conversation.agentError && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 break-words">{conversation.agentError}</span>
        </div>
      )}

      <MessageScrollerProvider>
        <MessageScroller className="flex-1 rounded-lg border bg-card">
          <MessageScrollerViewport aria-label="Messages" className="p-4">
            <MessageScrollerContent className="gap-3">
              {messages.length === 0 && (
                <p className="m-auto text-sm text-muted-foreground">
                  No messages yet. Say something to get started.
                </p>
              )}
              {messages.map((message) => (
                <MessageScrollerItem key={message.id} messageId={message.id}>
                  <MessageRow message={message} isMine={message.authorId === me} />
                </MessageScrollerItem>
              ))}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>

      {actionError && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
          <AlertCircle className="size-4" />
          {actionError}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex items-end gap-2"
      >
        <Textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={agentAttached ? "Message the group and the agent…" : "Message the group…"}
          aria-label="Message"
          rows={1}
          className="max-h-40 min-h-10"
        />
        <Button type="submit" disabled={isSending || !draft.trim()} aria-label="Send">
          {isSending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </Button>
      </form>

      <AttachAgentDialog
        open={agentDialogOpen}
        onOpenChange={setAgentDialogOpen}
        organizationId={conversation.organizationId}
        onAttach={async (vmId, model) => {
          await runAction(() => attachAgent(id, { vmId, model }), "Could not attach the agent");
          await reloadConversation();
        }}
      />
    </div>
  );
}

// ============================================================================
// Message rendering
// ============================================================================

function MessageRow({ message, isMine }: { message: ConversationMessage; isMine: boolean }) {
  if (message.authorKind === "system") {
    return (
      <Marker variant="separator">
        <MarkerContent>{message.body}</MarkerContent>
      </Marker>
    );
  }

  if (message.authorKind === "agent") {
    return <AgentMessage message={message} />;
  }

  return (
    <Message align={isMine ? "end" : "start"}>
      <MessageAvatar>
        <Avatar name={message.authorName} />
      </MessageAvatar>
      <MessageContent>
        <MessageHeader>
          <span className="font-medium text-foreground">{isMine ? "You" : message.authorName}</span>
          <time dateTime={message.createdAt}>{timeOfDay(message.createdAt)}</time>
        </MessageHeader>
        <Bubble variant={isMine ? "default" : "secondary"} align={isMine ? "end" : "start"}>
          <BubbleContent>{message.body}</BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}

function AgentMessage({ message }: { message: ConversationMessage }) {
  const streaming = message.status === "streaming";
  const parts = message.parts.length
    ? message.parts
    : message.body
      ? [{ type: "text", id: "body", text: message.body } satisfies MessagePart]
      : [];

  return (
    <Message>
      <MessageAvatar className="bg-primary/10 text-primary">
        <Avatar name="Agent" className="bg-transparent text-primary">
          <Bot className="size-4" />
        </Avatar>
      </MessageAvatar>
      <MessageContent>
        <MessageHeader>
          <span className="font-medium text-foreground">{message.authorName}</span>
          <time dateTime={message.createdAt}>{timeOfDay(message.createdAt)}</time>
        </MessageHeader>
        <div className="flex w-full flex-col gap-2">
          {parts.map((part, index) => (
            <AgentPart key={partKey(part, index)} part={part} />
          ))}
          {streaming && (
            <Marker>
              <MarkerIcon>
                <Loader2 className="animate-spin" />
              </MarkerIcon>
              <MarkerContent className="shimmer">
                {parts.length === 0 ? "Thinking…" : "Working…"}
              </MarkerContent>
            </Marker>
          )}
        </div>
      </MessageContent>
    </Message>
  );
}

function partKey(part: MessagePart, index: number): string {
  if (part.type === "text") return `text:${part.id}`;
  if (part.type === "tool") return `tool:${part.callId}`;
  return `error:${index}`;
}

function AgentPart({ part }: { part: MessagePart }) {
  if (part.type === "text") {
    return (
      <Bubble variant="ghost">
        <BubbleContent>{part.text}</BubbleContent>
      </Bubble>
    );
  }

  if (part.type === "error") {
    return (
      <Bubble variant="destructive">
        <BubbleContent>{part.message}</BubbleContent>
      </Bubble>
    );
  }

  return <ToolCall part={part} />;
}

function ToolCall({ part }: { part: Extract<MessagePart, { type: "tool" }> }) {
  const [open, setOpen] = useState(false);
  const summary = summarizeToolInput(part.input);
  return (
    <Marker
      variant="border"
      className={cn(
        "flex-col items-stretch gap-1",
        part.status === "error" && "border-destructive/40"
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
        aria-expanded={open}
      >
        <MarkerIcon>
          {part.status === "running" ? <Loader2 className="animate-spin" /> : <Wrench />}
        </MarkerIcon>
        <MarkerContent className={cn("truncate", part.status === "running" && "shimmer")}>
          <span className="font-medium text-foreground">{part.name}</span>
          {summary && <span className="ml-2 font-mono">{summary}</span>}
        </MarkerContent>
        <ChevronDown
          className={cn("ml-auto size-3.5 transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div className="space-y-2 pt-1">
          {part.input !== undefined && (
            <pre className="max-h-48 overflow-auto rounded bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap">
              {JSON.stringify(part.input, null, 2)}
            </pre>
          )}
          {part.output && (
            <pre className="max-h-64 overflow-auto rounded bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap">
              {part.output}
            </pre>
          )}
          {part.error && <p className="text-destructive">{part.error}</p>}
        </div>
      )}
    </Marker>
  );
}

/** A one-line hint of what a tool was asked to do. */
export function summarizeToolInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const record = input as Record<string, unknown>;
  for (const key of ["command", "filePath", "path", "pattern", "query", "url", "description"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.length > 80 ? `${value.slice(0, 77)}…` : value;
    }
  }
  return "";
}

// ============================================================================
// Attach agent dialog
// ============================================================================

function AttachAgentDialog({
  open,
  onOpenChange,
  organizationId,
  onAttach,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  onAttach: (vmId: string, model?: string) => Promise<void>;
}) {
  const [vms, setVms] = useState<VM[] | null>(null);
  const [vmId, setVmId] = useState("");
  const [model, setModel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    setVms(null);
    listVMs(undefined, { organizationId })
      .then((all) => {
        if (cancelled) return;
        const running = all.filter((vm) => vm.status === "running");
        setVms(running);
        setVmId((current) => current || running[0]?.id || "");
      })
      .catch((err) => !cancelled && setError(errorMessage(err, "Could not load VMs")));
    return () => {
      cancelled = true;
    };
  }, [open, organizationId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vmId) return;
    setIsSubmitting(true);
    try {
      await onAttach(vmId, model.trim() || undefined);
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Add an agent</DialogTitle>
            <DialogDescription>
              The agent runs opencode inside one of your running VMs, using the provider keys
              configured in{" "}
              <Link to="/settings" className="underline">
                Settings
              </Link>
              .
            </DialogDescription>
          </DialogHeader>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="space-y-2">
            <Label htmlFor="agent-vm">VM</Label>
            {vms === null ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : vms.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No running VMs. Start one on the{" "}
                <Link to="/" className="underline">
                  dashboard
                </Link>{" "}
                first.
              </p>
            ) : (
              <Select value={vmId} onValueChange={setVmId}>
                <SelectTrigger id="agent-vm" className="w-full">
                  <SelectValue placeholder="Pick a running VM" />
                </SelectTrigger>
                <SelectContent>
                  {vms.map((vm) => (
                    <SelectItem key={vm.id} value={vm.id}>
                      {vm.name} · {vm.ipAddress ?? "no IP"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="agent-model">Model (optional)</Label>
            <Input
              id="agent-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="anthropic/claude-sonnet-4-5"
            />
            <p className="text-xs text-muted-foreground">
              Written as provider/model. Leave empty to let opencode choose.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!vmId || isSubmitting}>
              {isSubmitting && <Loader2 className="size-4 animate-spin" />}
              Add agent
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
