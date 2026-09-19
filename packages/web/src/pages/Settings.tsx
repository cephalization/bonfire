/**
 * Settings
 *
 * Everything about the active organization that is not a VM: who is in it,
 * who has been invited, and the API keys the signed-in user holds for it.
 */

import { useCallback, useEffect, useState } from "react";
import { Copy, Check, Loader2, Trash2, UserPlus, KeyRound, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { FormError } from "@/components/AuthShell";
import {
  authClient,
  useSession,
  authErrorMessage,
  canManageOrganization,
  invitationLink,
  type OrganizationRole,
} from "@/lib/auth";

interface MemberRow {
  id: string;
  role: string;
  userId: string;
  user: { name: string; email: string };
}

interface InvitationRow {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt?: string | Date | null;
}

interface OrganizationView {
  id: string;
  name: string;
  slug: string;
  members: MemberRow[];
  invitations: InvitationRow[];
}

interface ApiKeyRow {
  id: string;
  name: string | null;
  start: string | null;
  createdAt: string | Date;
  lastRequest?: string | Date | null;
  metadata?: { organizationId?: string } | null;
}

const ROLES: OrganizationRole[] = ["member", "admin", "owner"];

function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "never";
  return new Date(value).toLocaleString();
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label={label}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
    </Button>
  );
}

export function Settings() {
  const { data: session } = useSession();
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id;

  const [org, setOrg] = useState<OrganizationView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    const result = await authClient.organization.getFullOrganization({
      query: { organizationId },
    });
    if (result.error || !result.data) {
      setError(authErrorMessage(result.error, "Could not load the organization"));
      return;
    }
    setOrg(result.data as unknown as OrganizationView);
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const myRole = org?.members.find((m) => m.userId === session?.user.id)?.role;
  const canManage = canManageOrganization(myRole);

  if (!org) {
    return (
      <div className="flex items-center justify-center py-12">
        {error ? (
          <FormError message={error} />
        ) : (
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{org.name}</h1>
        <p className="text-sm text-muted-foreground">
          {org.slug} · you are {myRole ?? "a member"}
        </p>
      </div>

      <FormError message={error} />

      <MembersCard
        org={org}
        canManage={canManage}
        currentUserId={session?.user.id}
        onChanged={load}
        onError={setError}
      />
      <InvitationsCard org={org} canManage={canManage} onChanged={load} onError={setError} />
      <ApiKeysCard organizationId={org.id} onError={setError} />
    </div>
  );
}

function MembersCard({
  org,
  canManage,
  currentUserId,
  onChanged,
  onError,
}: {
  org: OrganizationView;
  canManage: boolean;
  currentUserId?: string;
  onChanged: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);

  const changeRole = async (member: MemberRow, role: OrganizationRole) => {
    setBusyId(member.id);
    onError(null);
    const result = await authClient.organization.updateMemberRole({
      memberId: member.id,
      role,
      organizationId: org.id,
    });
    if (result.error) onError(authErrorMessage(result.error, "Could not change the role"));
    await onChanged();
    setBusyId(null);
  };

  const remove = async (member: MemberRow) => {
    setBusyId(member.id);
    onError(null);
    const result = await authClient.organization.removeMember({
      memberIdOrEmail: member.id,
      organizationId: org.id,
    });
    if (result.error) onError(authErrorMessage(result.error, "Could not remove the member"));
    await onChanged();
    setBusyId(null);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
        <CardDescription>People who can see and manage this organization's VMs.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {org.members.map((member) => {
            const isSelf = member.userId === currentUserId;
            return (
              <li
                key={member.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
                data-testid={`member-${member.user.email}`}
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {member.user.name}
                    {isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                  </p>
                  <p className="truncate text-sm text-muted-foreground">{member.user.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  {canManage && !isSelf ? (
                    <Select
                      value={member.role}
                      onValueChange={(role) => changeRole(member, role as OrganizationRole)}
                      disabled={busyId === member.id}
                    >
                      <SelectTrigger className="w-28" aria-label={`Role for ${member.user.email}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLES.map((role) => (
                          <SelectItem key={role} value={role}>
                            {role}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge variant="secondary">{member.role}</Badge>
                  )}
                  {canManage && !isSelf && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${member.user.email}`}
                      disabled={busyId === member.id}
                      onClick={() => remove(member)}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function InvitationsCard({
  org,
  canManage,
  onChanged,
  onError,
}: {
  org: OrganizationView;
  canManage: boolean;
  onChanged: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrganizationRole>("member");
  const [isInviting, setIsInviting] = useState(false);
  const [lastLink, setLastLink] = useState<string | null>(null);

  const pending = org.invitations.filter((i) => i.status === "pending");

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setIsInviting(true);
    onError(null);
    const result = await authClient.organization.inviteMember({
      email: email.trim(),
      role,
      organizationId: org.id,
      resend: true,
    });
    if (result.error || !result.data) {
      onError(authErrorMessage(result.error, "Could not send the invitation"));
    } else {
      setLastLink(invitationLink(result.data.id));
      setEmail("");
    }
    await onChanged();
    setIsInviting(false);
  };

  const cancel = async (invitation: InvitationRow) => {
    onError(null);
    const result = await authClient.organization.cancelInvitation({
      invitationId: invitation.id,
    });
    if (result.error) onError(authErrorMessage(result.error, "Could not cancel the invitation"));
    await onChanged();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invitations</CardTitle>
        <CardDescription>
          There is no email service yet: share the invitation link yourself. The invitee signs up
          with the invited email address and accepts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {canManage && (
          <form onSubmit={invite} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="teammate@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isInviting}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="invite-role">Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as OrganizationRole)}>
                <SelectTrigger id="invite-role" className="w-full sm:w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="submit"
              disabled={isInviting || !email.trim()}
              data-testid="invite-submit"
            >
              {isInviting ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <UserPlus className="mr-2 size-4" />
              )}
              Invite
            </Button>
          </form>
        )}

        {lastLink && (
          <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-3 text-sm">
            <span className="min-w-0 flex-1 truncate font-mono">{lastLink}</span>
            <CopyButton value={lastLink} label="Copy invitation link" />
          </div>
        )}

        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">No pending invitations.</p>
        ) : (
          <ul className="divide-y">
            {pending.map((invitation) => (
              <li
                key={invitation.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
                data-testid={`invitation-${invitation.email}`}
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{invitation.email}</p>
                  <p className="text-sm text-muted-foreground">
                    {invitation.role} · expires {formatDate(invitation.expiresAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <CopyButton
                    value={invitationLink(invitation.id)}
                    label={`Copy link for ${invitation.email}`}
                  />
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Cancel invitation for ${invitation.email}`}
                      onClick={() => cancel(invitation)}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ApiKeysCard({
  organizationId,
  onError,
}: {
  organizationId: string;
  onError: (message: string | null) => void;
}) {
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null);
  const [name, setName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await authClient.apiKey.list();
    if (result.error || !result.data) {
      onError(authErrorMessage(result.error, "Could not load API keys"));
      return;
    }
    // Only keys for this organization; the list is per user.
    setKeys(
      (result.data as unknown as ApiKeyRow[]).filter(
        (k) => k.metadata?.organizationId === organizationId
      )
    );
  }, [organizationId, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);
    onError(null);
    const result = await authClient.apiKey.create({
      name: name.trim() || "CLI",
      metadata: { organizationId },
    });
    if (result.error || !result.data) {
      onError(authErrorMessage(result.error, "Could not create the API key"));
    } else {
      setCreatedKey(result.data.key);
      setName("");
      await load();
    }
    setIsCreating(false);
  };

  const remove = async (key: ApiKeyRow) => {
    onError(null);
    const result = await authClient.apiKey.delete({ keyId: key.id });
    if (result.error) onError(authErrorMessage(result.error, "Could not delete the API key"));
    await load();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>API keys</CardTitle>
        <CardDescription>
          Keys act as you, in this organization. Use one with <code>bonfire login</code> or the SDK.
          The full key is shown once, when it is created.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={create} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1">
            <Label htmlFor="key-name">Name</Label>
            <Input
              id="key-name"
              placeholder="laptop CLI"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isCreating}
            />
          </div>
          <Button type="submit" disabled={isCreating} data-testid="create-key-submit">
            {isCreating ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <KeyRound className="mr-2 size-4" />
            )}
            Create key
          </Button>
        </form>

        {keys === null ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        ) : keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">No API keys for this organization.</p>
        ) : (
          <ul className="divide-y">
            {keys.map((key) => (
              <li
                key={key.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
                data-testid={`api-key-${key.id}`}
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{key.name || "Unnamed key"}</p>
                  <p className="text-sm text-muted-foreground">
                    <span className="font-mono">{key.start}…</span> · created{" "}
                    {formatDate(key.createdAt)} · last used {formatDate(key.lastRequest)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete key ${key.name || key.id}`}
                  onClick={() => remove(key)}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={createdKey !== null} onOpenChange={(open) => !open && setCreatedKey(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Your new API key</DialogTitle>
            <DialogDescription>
              Copy it now. For your safety it will not be shown again.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-3">
            <code className="min-w-0 flex-1 break-all text-sm" data-testid="created-key">
              {createdKey}
            </code>
            {createdKey && <CopyButton value={createdKey} label="Copy API key" />}
          </div>
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>
              Run <code>bonfire login</code> and paste this key when prompted.
            </span>
          </div>
          <DialogFooter>
            <Button onClick={() => setCreatedKey(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
