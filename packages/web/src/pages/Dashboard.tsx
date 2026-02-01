import { useEffect, useState, useCallback } from "react";
import { Plus, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VMList } from "@/components/VMList";
import { CreateVMDialog } from "@/components/CreateVMDialog";
import {
  listVMs,
  startVM,
  stopVM,
  deleteVM,
  type VM,
  BonfireAPIError,
} from "@/lib/api";

export function Dashboard() {
  const [vms, setVms] = useState<VM[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  const fetchVMs = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await listVMs();
      setVms(data);
    } catch (err) {
      const message =
        err instanceof BonfireAPIError
          ? err.message
          : "Failed to fetch VMs. Please try again.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVMs();
  }, [fetchVMs]);

  const handleStart = async (id: string) => {
    setActionLoading((prev) => ({ ...prev, [id]: true }));
    try {
      await startVM(id);
      await fetchVMs();
    } catch (err) {
      const message =
        err instanceof BonfireAPIError ? err.message : "Failed to start VM";
      setError(message);
    } finally {
      setActionLoading((prev) => ({ ...prev, [id]: false }));
    }
  };

  const handleStop = async (id: string) => {
    setActionLoading((prev) => ({ ...prev, [id]: true }));
    try {
      await stopVM(id);
      await fetchVMs();
    } catch (err) {
      const message =
        err instanceof BonfireAPIError ? err.message : "Failed to stop VM";
      setError(message);
    } finally {
      setActionLoading((prev) => ({ ...prev, [id]: false }));
    }
  };

  const handleDelete = async (id: string) => {
    setActionLoading((prev) => ({ ...prev, [id]: true }));
    try {
      await deleteVM(id);
      await fetchVMs();
    } catch (err) {
      const message =
        err instanceof BonfireAPIError ? err.message : "Failed to delete VM";
      setError(message);
    } finally {
      setActionLoading((prev) => ({ ...prev, [id]: false }));
    }
  };

  const handleCreateVMSuccess = () => {
    fetchVMs();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Virtual Machines</h1>
          <p className="text-muted-foreground">
            Manage your Firecracker microVMs
          </p>
        </div>
        <CreateVMDialog onSuccess={handleCreateVMSuccess}>
          <Button
            className="min-h-[44px] w-full sm:w-auto"
            data-testid="create-vm-btn"
          >
            <Plus className="mr-2 size-4" />
            Create VM
          </Button>
        </CreateVMDialog>
      </div>

      {/* Error Alert */}
      {error && (
        <div
          className="flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive"
          data-testid="dashboard-error"
        >
          <AlertCircle className="mt-0.5 size-5 shrink-0" />
          <div className="flex-1">
            <p className="font-medium">Error</p>
            <p className="text-sm">{error}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setError(null)}
            className="shrink-0"
          >
            Dismiss
          </Button>
        </div>
      )}

      {/* VM List */}
      {isLoading ? (
        <div
          className="flex flex-col items-center justify-center py-12"
          data-testid="dashboard-loading"
        >
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
          <p className="mt-4 text-sm text-muted-foreground">Loading VMs...</p>
        </div>
      ) : (
        <VMList
          vms={vms}
          onStart={handleStart}
          onStop={handleStop}
          onDelete={handleDelete}
          isLoading={actionLoading[vms[0]?.id]}
        />
      )}
    </div>
  );
}
