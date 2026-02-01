import { Server } from "lucide-react";
import { VMCard } from "./VMCard";
import type { VM } from "@/lib/api";

interface VMListProps {
  vms: VM[];
  onStart?: (id: string) => void;
  onStop?: (id: string) => void;
  onDelete?: (id: string) => void;
  isLoading?: boolean;
}

export function VMList({ vms, onStart, onStop, onDelete, isLoading }: VMListProps) {
  if (vms.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center"
        data-testid="vm-list-empty"
      >
        <div className="flex size-16 items-center justify-center rounded-full bg-muted">
          <Server className="size-8 text-muted-foreground" />
        </div>
        <h3 className="mt-4 text-lg font-semibold">No VMs yet</h3>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          Create your first virtual machine to get started with Bonfire.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3" data-testid="vm-list">
      {vms.map((vm) => (
        <VMCard
          key={vm.id}
          vm={vm}
          onStart={onStart}
          onStop={onStop}
          onDelete={onDelete}
          isLoading={isLoading}
        />
      ))}
    </div>
  );
}
