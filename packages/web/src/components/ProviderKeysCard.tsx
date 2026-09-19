import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  BonfireAPIError,
  deleteProviderKey,
  listProviders,
  setProviderKey,
  type Provider,
} from "@/lib/api";
import { relativeTime } from "@/lib/time";

/**
 * Per-organization LLM provider keys. Every member sees which providers are
 * configured; admins and owners can set or remove keys. Keys are written into
 * the VM an agent runs in and are never shown again after saving.
 */
export function ProviderKeysCard({
  organizationId,
  canManage,
  onError,
}: {
  organizationId: string;
  canManage: boolean;
  onError: (message: string | null) => void;
}) {
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setProviders(await listProviders(organizationId));
    } catch (err) {
      onError(err instanceof BonfireAPIError ? err.message : "Could not load provider keys");
    }
  }, [organizationId, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (provider: Provider) => {
    onError(null);
    try {
      await deleteProviderKey(organizationId, provider.id);
      await load();
    } catch (err) {
      onError(err instanceof BonfireAPIError ? err.message : "Could not remove the key");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>LLM provider keys</CardTitle>
        <CardDescription>
          Agents in this organization's VMs use these keys. They are stored encrypted and
          {canManage
            ? " can be replaced at any time."
            : " can only be changed by admins and owners."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {providers === null ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        ) : (
          <ul className="divide-y">
            {providers.map((provider) => (
              <li key={provider.id} className="py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{provider.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {provider.configured ? (
                        <>
                          Key ending in <span className="font-mono">{provider.keyHint}</span>
                          {provider.label ? ` (${provider.label})` : ""}
                          {provider.updatedAt
                            ? ` · updated ${relativeTime(provider.updatedAt)}`
                            : ""}
                        </>
                      ) : (
                        "Not configured"
                      )}
                    </p>
                  </div>
                  <a
                    href={provider.keysUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    Get a key <ExternalLink className="size-3" />
                  </a>
                  {canManage && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditing(editing === provider.id ? null : provider.id)}
                      >
                        {provider.configured ? "Replace key" : "Set key"}
                      </Button>
                      {provider.configured && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => remove(provider)}
                          aria-label={`Remove ${provider.name} key`}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </>
                  )}
                </div>
                {canManage && editing === provider.id && (
                  <ProviderKeyForm
                    organizationId={organizationId}
                    provider={provider}
                    onSaved={async () => {
                      setEditing(null);
                      await load();
                    }}
                    onCancel={() => setEditing(null)}
                    onError={onError}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ProviderKeyForm({
  organizationId,
  provider,
  onSaved,
  onCancel,
  onError,
}: {
  organizationId: string;
  provider: Provider;
  onSaved: () => Promise<void>;
  onCancel: () => void;
  onError: (message: string | null) => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [label, setLabel] = useState(provider.label ?? "");
  const [isSaving, setIsSaving] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    onError(null);
    try {
      await setProviderKey(organizationId, provider.id, {
        apiKey,
        label: label.trim() || undefined,
      });
      await onSaved();
    } catch (err) {
      onError(err instanceof BonfireAPIError ? err.message : "Could not save the key");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form
      onSubmit={save}
      className="mt-3 grid gap-3 rounded-md border bg-muted/30 p-3 sm:grid-cols-[1fr_auto_auto] sm:items-end"
    >
      <div className="space-y-1">
        <Label htmlFor={`key-${provider.id}`}>{provider.name} API key</Label>
        <Input
          id={`key-${provider.id}`}
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Paste the key"
          required
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`label-${provider.id}`}>Label</Label>
        <Input
          id={`label-${provider.id}`}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="optional"
          className="sm:w-36"
        />
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSaving || apiKey.trim().length < 8}>
          {isSaving && <Loader2 className="size-4 animate-spin" />}
          Save
        </Button>
      </div>
    </form>
  );
}
