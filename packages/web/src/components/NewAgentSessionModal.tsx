import { useState, useEffect } from "react";
import { Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createAgentSession,
  listVMs,
  type AgentSession,
  type VM,
  BonfireAPIError,
} from "@/lib/api";

interface NewAgentSessionModalProps {
  onSuccess?: (session: AgentSession) => void;
  children?: React.ReactNode;
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(query);
    if (media.matches !== matches) {
      setMatches(media.matches);
    }
    const listener = () => setMatches(media.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [matches, query]);

  return matches;
}

function NewAgentSessionForm({
  onSuccess,
  onCancel,
}: {
  onSuccess?: (session: AgentSession) => void;
  onCancel: () => void;
}) {
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [title, setTitle] = useState("");
  const [vmId, setVmId] = useState("");
  const [vms, setVms] = useState<VM[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingVMs, setIsFetchingVMs] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchVMs = async () => {
      setIsFetchingVMs(true);
      try {
        const data = await listVMs();
        // Only show running VMs
        const runningVMs = data.filter((vm) => vm.status === "running");
        setVms(runningVMs);
        if (runningVMs.length > 0) {
          setVmId(runningVMs[0].id);
        }
      } catch (err) {
        console.error("Failed to fetch VMs:", err);
      } finally {
        setIsFetchingVMs(false);
      }
    };

    fetchVMs();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!repoUrl.trim()) {
      setError("Repository URL is required");
      return;
    }

    if (!vmId) {
      setError("Please select a VM");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const session = await createAgentSession({
        repoUrl: repoUrl.trim(),
        branch: branch.trim() || undefined,
        title: title.trim() || undefined,
        vmId,
      });
      onSuccess?.(session);
    } catch (err) {
      const message =
        err instanceof BonfireAPIError
          ? err.message
          : "Failed to create session. Please try again.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const formContent = (
    <>
      <div className="grid gap-4 py-4">
        <div className="grid gap-2">
          <Label htmlFor="repoUrl">
            Repository URL <span className="text-destructive">*</span>
          </Label>
          <Input
            id="repoUrl"
            placeholder="e.g., https://github.com/org/repo"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            disabled={isLoading}
            className="min-h-[44px]"
            data-testid="repo-url-input"
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="branch">Branch (optional)</Label>
          <Input
            id="branch"
            placeholder="e.g., main"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            disabled={isLoading}
            className="min-h-[44px]"
            data-testid="branch-input"
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="title">Title (optional)</Label>
          <Input
            id="title"
            placeholder="e.g., My Project"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={isLoading}
            className="min-h-[44px]"
            data-testid="title-input"
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="vm">
            VM <span className="text-destructive">*</span>
          </Label>
          <Select
            value={vmId}
            onValueChange={setVmId}
            disabled={isLoading || isFetchingVMs || vms.length === 0}
          >
            <SelectTrigger className="min-h-[44px] w-full" data-testid="vm-select">
              <SelectValue
                placeholder={
                  isFetchingVMs
                    ? "Loading VMs..."
                    : vms.length === 0
                      ? "No running VMs available"
                      : "Select a VM"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {vms.map((vm) => (
                <SelectItem key={vm.id} value={vm.id}>
                  {vm.name} ({vm.ipAddress || "no IP"})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {vms.length === 0 && !isFetchingVMs && (
            <p className="text-xs text-muted-foreground">
              No running VMs available. Start a VM first to create an agent session.
            </p>
          )}
        </div>

        {error && (
          <div
            className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
            data-testid="create-session-error"
          >
            {error}
          </div>
        )}
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isLoading}
          className="min-h-[44px] w-full sm:w-auto"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={isLoading || !repoUrl.trim() || !vmId}
          className="min-h-[44px] w-full sm:w-auto"
          data-testid="create-session-submit"
        >
          {isLoading ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Creating...
            </>
          ) : (
            <>
              <Plus className="mr-2 size-4" />
              Create Session
            </>
          )}
        </Button>
      </div>
    </>
  );

  return <form onSubmit={handleSubmit}>{formContent}</form>;
}

export function NewAgentSessionModal({ onSuccess, children }: NewAgentSessionModalProps) {
  const [open, setOpen] = useState(false);
  const isDesktop = useMediaQuery("(min-width: 640px)");

  const handleSuccess = (session: AgentSession) => {
    onSuccess?.(session);
    setOpen(false);
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
  };

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
          {children || (
            <Button className="min-h-[44px]" data-testid="new-session-btn">
              <Plus className="mr-2 size-4" />
              New Session
            </Button>
          )}
        </DialogTrigger>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Agent Session</DialogTitle>
            <DialogDescription>
              Create a new agent session to work with an AI-powered development environment.
            </DialogDescription>
          </DialogHeader>
          <NewAgentSessionForm onSuccess={handleSuccess} onCancel={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer open={open} onOpenChange={handleOpenChange}>
      <DrawerTrigger asChild>
        {children || (
          <Button className="min-h-[44px]" data-testid="new-session-btn">
            <Plus className="mr-2 size-4" />
            New Session
          </Button>
        )}
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Create Agent Session</DrawerTitle>
          <DrawerDescription>
            Create a new agent session to work with an AI-powered development environment.
          </DrawerDescription>
        </DrawerHeader>
        <div className="px-4">
          <NewAgentSessionForm onSuccess={handleSuccess} onCancel={() => setOpen(false)} />
        </div>
        <DrawerFooter />
      </DrawerContent>
    </Drawer>
  );
}
