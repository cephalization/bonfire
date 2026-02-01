import { useNavigate } from "react-router-dom";
import { Play, Square, Trash2, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { VM } from "@/lib/api";

interface VMCardProps {
  vm: VM;
  onStart?: (id: string) => void;
  onStop?: (id: string) => void;
  onDelete?: (id: string) => void;
  isLoading?: boolean;
}

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

export function VMCard({ vm, onStart, onStop, onDelete, isLoading }: VMCardProps) {
  const navigate = useNavigate();
  const status = statusConfig[vm.status];

  const handleCardClick = () => {
    navigate(`/vms/${vm.id}`);
  };

  const handleActionClick = (e: React.MouseEvent, action: () => void) => {
    e.stopPropagation();
    action();
  };

  return (
    <Card
      className={cn(
        "cursor-pointer transition-all hover:shadow-md",
        isLoading && "opacity-60 pointer-events-none"
      )}
      onClick={handleCardClick}
      data-testid={`vm-card-${vm.id}`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <CardTitle className="truncate text-lg" title={vm.name}>
              {vm.name}
            </CardTitle>
            <CardDescription className="mt-1">
              {vm.vcpus} vCPU{vm.vcpus > 1 ? "s" : ""} · {vm.memoryMib} MB
            </CardDescription>
          </div>
          <Badge
            variant={status.variant}
            className={cn("shrink-0", status.className)}
            data-testid="vm-status-badge"
          >
            {status.label}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="pb-3 pt-0">
        {vm.ipAddress && (
          <p className="text-sm text-muted-foreground" data-testid="vm-ip">
            IP: {vm.ipAddress}
          </p>
        )}
        {vm.status === "running" && !vm.ipAddress && (
          <p className="text-sm text-muted-foreground italic">Starting...</p>
        )}
      </CardContent>

      <CardFooter className="flex flex-wrap gap-2 pt-0">
        {(vm.status === "stopped" || vm.status === "creating") && onStart && (
          <Button
            variant="outline"
            size="sm"
            className="min-h-[36px] flex-1 sm:flex-none"
            onClick={(e) => handleActionClick(e, () => onStart(vm.id))}
            data-testid="vm-start-btn"
          >
            <Play className="mr-1 size-4" />
            Start
          </Button>
        )}

        {vm.status === "running" && onStop && (
          <Button
            variant="outline"
            size="sm"
            className="min-h-[36px] flex-1 sm:flex-none"
            onClick={(e) => handleActionClick(e, () => onStop(vm.id))}
            data-testid="vm-stop-btn"
          >
            <Square className="mr-1 size-4" />
            Stop
          </Button>
        )}

        <Button
          variant="outline"
          size="sm"
          className="min-h-[36px] flex-1 sm:flex-none"
          onClick={(e) => handleActionClick(e, () => navigate(`/vms/${vm.id}`))}
          data-testid="vm-terminal-btn"
        >
          <Terminal className="mr-1 size-4" />
          Terminal
        </Button>

        {onDelete && (
          <Button
            variant="outline"
            size="sm"
            className="min-h-[36px] flex-1 border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive sm:flex-none"
            onClick={(e) => handleActionClick(e, () => onDelete(vm.id))}
            data-testid="vm-delete-btn"
          >
            <Trash2 className="mr-1 size-4" />
            Delete
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
