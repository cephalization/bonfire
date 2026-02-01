import { useState } from "react";
import { Download, Loader2, Zap } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { pullImage, quickStartImage, type Image, BonfireAPIError } from "@/lib/api";

interface PullImageDialogProps {
  onSuccess?: (image: Image) => void;
  children?: React.ReactNode;
}

export function PullImageDialog({ onSuccess, children }: PullImageDialogProps) {
  const [open, setOpen] = useState(false);
  const [reference, setReference] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isQuickStarting, setIsQuickStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!reference.trim()) {
      setError("Image reference is required");
      return;
    }

    setIsLoading(true);
    setError(null);
    setStatus("Pulling image...");

    try {
      const image = await pullImage({ reference: reference.trim() });
      setStatus("Image pulled successfully!");
      onSuccess?.(image);

      // Close dialog after a brief delay to show success
      setTimeout(() => {
        setOpen(false);
        setReference("");
        setStatus("");
      }, 1000);
    } catch (err) {
      const message =
        err instanceof BonfireAPIError ? err.message : "Failed to pull image. Please try again.";
      setError(message);
      setStatus("");
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickStart = async () => {
    setIsQuickStarting(true);
    setError(null);
    setStatus("Downloading quick start image (Ubuntu 22.04)...");

    try {
      const image = await quickStartImage();
      setStatus("Quick start image downloaded successfully!");
      onSuccess?.(image);

      // Close dialog after a brief delay to show success
      setTimeout(() => {
        setOpen(false);
        setReference("");
        setStatus("");
      }, 1000);
    } catch (err) {
      const message =
        err instanceof BonfireAPIError
          ? err.message
          : "Failed to download quick start image. Please try again.";
      setError(message);
      setStatus("");
    } finally {
      setIsQuickStarting(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      // Reset state when closing
      setReference("");
      setError(null);
      setStatus("");
      setIsLoading(false);
      setIsQuickStarting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {children || (
          <Button className="min-h-[44px]" data-testid="pull-image-btn">
            <Download className="mr-2 size-4" />
            Pull Image
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Pull Image</DialogTitle>
            <DialogDescription>
              Pull a Firecracker-compatible image containing a kernel and rootfs.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Quick Start Section */}
            <div className="rounded-lg border bg-muted/50 p-4">
              <h4 className="mb-2 text-sm font-medium flex items-center gap-2">
                <Zap className="size-4 text-yellow-500" />
                Quick Start
              </h4>
              <p className="mb-3 text-xs text-muted-foreground">
                New to Bonfire? Download our pre-configured Ubuntu 24.04 image to get started
                immediately.
              </p>
              <Button
                type="button"
                onClick={handleQuickStart}
                disabled={isQuickStarting || isLoading}
                className="w-full min-h-[44px]"
                variant="secondary"
                data-testid="quick-start-btn"
              >
                {isQuickStarting ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Downloading...
                  </>
                ) : (
                  <>
                    <Zap className="mr-2 size-4" />
                    Quick Start (Ubuntu 24.04)
                  </>
                )}
              </Button>
            </div>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">
                  Or pull custom image
                </span>
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="reference">Image Reference</Label>
              <Input
                id="reference"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                disabled={isLoading || isQuickStarting}
                className="min-h-[44px]"
                data-testid="image-reference-input"
              />
              <p className="text-xs text-muted-foreground">
                Enter the full image reference including registry, namespace, and tag.
                <br />
                Note: Slicer images (ghcr.io/openfaasltd/*) require authentication.
              </p>
            </div>

            {error && (
              <div
                className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
                data-testid="pull-image-error"
              >
                {error}
              </div>
            )}

            {status && !error && (
              <div
                className="flex items-center gap-2 rounded-lg border border-blue-500/20 bg-blue-500/10 p-3 text-sm text-blue-700"
                data-testid="pull-image-status"
              >
                {(isLoading || isQuickStarting) && <Loader2 className="size-4 animate-spin" />}
                <span>{status}</span>
              </div>
            )}
          </div>

          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isLoading || isQuickStarting}
              className="min-h-[44px] w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isLoading || isQuickStarting || !reference.trim()}
              className="min-h-[44px] w-full sm:w-auto"
              data-testid="pull-image-submit"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Pulling...
                </>
              ) : (
                <>
                  <Download className="mr-2 size-4" />
                  Pull Image
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
