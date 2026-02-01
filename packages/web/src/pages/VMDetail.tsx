/**
 * VM Detail Page
 *
 * Displays VM information with full terminal access.
 * Features:
 * - Header with VM name, status badge, IP address
 * - Action buttons: Start/Stop, Delete
 * - Full-screen terminal (ghostty-web)
 * - Mobile responsive: actions above terminal in horizontal scroll
 */

import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Play,
  Square,
  Trash2,
  ArrowLeft,
  Loader2,
  AlertCircle,
  Monitor,
  Cpu,
  HardDrive,
  Clock,
  Network,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Terminal } from "@/components/Terminal";
import { getVM, startVM, stopVM, deleteVM, type VM, BonfireAPIError } from "@/lib/api";
import { cn } from "@/lib/utils";

const statusConfig = {
  running: {
    label: "Running",
    variant: "default" as const,
    className: "bg-green-500/15 text-green-700 border-green-500/20 hover:bg-green-500/20",
  },
  stopped: {
    label: "Stopped",
    variant: "secondary" as const,
    className: "bg-gray-500/15 text-gray-700 border-gray-500/20 hover:bg-gray-500/20",
  },
  creating: {
    label: "Creating",
    variant: "secondary" as const,
    className: "bg-yellow-500/15 text-yellow-700 border-yellow-500/20 hover:bg-yellow-500/20",
  },
  error: {
    label: "Error",
    variant: "destructive" as const,
    className: "",
  },
};

export function VMDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [vm, setVm] = useState<VM | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const fetchVM = useCallback(async () => {
    if (!id) return;

    try {
      setIsLoading(true);
      setError(null);
      const data = await getVM(id);
      setVm(data);
    } catch (err) {
      const message =
        err instanceof BonfireAPIError
          ? err.message
          : "Failed to fetch VM details. Please try again.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchVM();
  }, [fetchVM]);

  const handleStart = async () => {
    if (!id) return;
    setIsActionLoading(true);
    try {
      await startVM(id);
      await fetchVM();
    } catch (err) {
      const message = err instanceof BonfireAPIError ? err.message : "Failed to start VM";
      setError(message);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleStop = async () => {
    if (!id) return;
    setIsActionLoading(true);
    try {
      await stopVM(id);
      await fetchVM();
    } catch (err) {
      const message = err instanceof BonfireAPIError ? err.message : "Failed to stop VM";
      setError(message);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    setIsActionLoading(true);
    try {
      await deleteVM(id);
      navigate("/");
    } catch (err) {
      const message = err instanceof BonfireAPIError ? err.message : "Failed to delete VM";
      setError(message);
      setIsActionLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
        <p className="mt-4 text-sm text-muted-foreground">Loading VM details...</p>
      </div>
    );
  }

  if (error && !vm) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center">
        <AlertCircle className="size-12 text-destructive" />
        <p className="mt-4 text-lg font-medium">Error</p>
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/")}>
          <ArrowLeft className="mr-2 size-4" />
          Back to Dashboard
        </Button>
      </div>
    );
  }

  if (!vm) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center">
        <Monitor className="size-12 text-muted-foreground" />
        <p className="mt-4 text-lg font-medium">VM Not Found</p>
        <p className="text-sm text-muted-foreground">
          The VM you&apos;re looking for doesn&apos;t exist.
        </p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/")}>
          <ArrowLeft className="mr-2 size-4" />
          Back to Dashboard
        </Button>
      </div>
    );
  }

  const status = statusConfig[vm.status];

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-4 lg:h-[calc(100vh-4rem)]">
      {/* Header Section */}
      <div className="flex flex-col gap-4">
        {/* Back button and title */}
        <div className="flex items-start gap-4">
          <Button variant="outline" size="icon" className="shrink-0" onClick={() => navigate("/")}>
            <ArrowLeft className="size-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-bold sm:text-2xl" title={vm.name}>
                {vm.name}
              </h1>
              <Badge variant={status.variant} className={cn("shrink-0", status.className)}>
                {status.label}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">ID: {vm.id}</p>
          </div>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive">
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

        {/* Info Cards */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-4">
          <div className="flex items-center gap-2 rounded-lg border p-3">
            <Cpu className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">vCPUs</p>
              <p className="truncate font-medium">{vm.vcpus}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-lg border p-3">
            <HardDrive className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Memory</p>
              <p className="truncate font-medium">{vm.memoryMib} MB</p>
            </div>
          </div>
          {vm.ipAddress && (
            <div className="flex items-center gap-2 rounded-lg border p-3">
              <Network className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">IP Address</p>
                <p className="truncate font-mono text-sm">{vm.ipAddress}</p>
              </div>
            </div>
          )}
          <div className="flex items-center gap-2 rounded-lg border p-3">
            <Clock className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Created</p>
              <p className="truncate text-sm">{formatDate(vm.createdAt)}</p>
            </div>
          </div>
        </div>

        {/* Action Buttons - Mobile: horizontal scroll, Desktop: row */}
        <div className="flex gap-2 overflow-x-auto pb-2 sm:pb-0">
          {vm.status === "stopped" && (
            <Button
              onClick={handleStart}
              disabled={isActionLoading}
              className="min-h-[44px] shrink-0"
              data-testid="vm-start-btn"
            >
              {isActionLoading ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Play className="mr-2 size-4" />
              )}
              Start VM
            </Button>
          )}

          {vm.status === "running" && (
            <Button
              onClick={handleStop}
              disabled={isActionLoading}
              variant="outline"
              className="min-h-[44px] shrink-0"
              data-testid="vm-stop-btn"
            >
              {isActionLoading ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Square className="mr-2 size-4" />
              )}
              Stop VM
            </Button>
          )}

          <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                disabled={isActionLoading}
                className="min-h-[44px] shrink-0 border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
                data-testid="vm-delete-btn"
              >
                <Trash2 className="mr-2 size-4" />
                Delete
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete VM</DialogTitle>
                <DialogDescription>
                  Are you sure you want to delete <strong>{vm.name}</strong>? This action cannot be
                  undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="flex-col gap-2 sm:flex-row">
                <Button
                  variant="outline"
                  onClick={() => setDeleteDialogOpen(false)}
                  className="w-full sm:w-auto"
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={isActionLoading}
                  className="w-full sm:w-auto"
                >
                  {isActionLoading && <Loader2 className="mr-2 size-4 animate-spin" />}
                  Delete VM
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Terminal Section - Fills remaining height */}
      <div className="flex-1 min-h-0">
        {vm.status === "running" ? (
          <Terminal vmId={vm.id} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center rounded-md border border-dashed border-border bg-muted/50">
            <Monitor className="size-12 text-muted-foreground" />
            <p className="mt-4 text-lg font-medium">VM is {vm.status}</p>
            <p className="text-sm text-muted-foreground">Start the VM to access the terminal.</p>
            {vm.status === "stopped" && (
              <Button onClick={handleStart} className="mt-4" disabled={isActionLoading}>
                {isActionLoading ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <Play className="mr-2 size-4" />
                )}
                Start VM
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default VMDetail;
