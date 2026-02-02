import { useState, useEffect } from "react";
import { Plus, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
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
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createVM,
  listImages,
  registerLocalImage,
  type VM,
  type Image,
  BonfireAPIError,
} from "@/lib/api";

interface CreateVMDialogProps {
  onSuccess?: (vm: VM) => void;
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

function CreateVMForm({
  onSuccess,
  onCancel,
}: {
  onSuccess?: (vm: VM) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [vcpus, setVcpus] = useState(1);
  const [memoryMib, setMemoryMib] = useState(512);
  const [imageId, setImageId] = useState("");
  const [images, setImages] = useState<Image[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingImages, setIsFetchingImages] = useState(false);
  const [isRegisteringLocal, setIsRegisteringLocal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [localKernelPath, setLocalKernelPath] = useState("/app/images/agent-kernel");
  const [localRootfsPath, setLocalRootfsPath] = useState("/app/images/agent-rootfs.ext4");

  useEffect(() => {
    const fetchImages = async () => {
      setIsFetchingImages(true);
      try {
        const data = await listImages();
        setImages(data);

        // Prefer a locally-registered agent-ready image if present.
        if (!imageId) {
          const preferred = data.find((img) => img.reference === "local:agent-ready");
          if (preferred) setImageId(preferred.id);
        }
      } catch (err) {
        console.error("Failed to fetch images:", err);
      } finally {
        setIsFetchingImages(false);
      }
    };

    fetchImages();
  }, []);

  const handleRegisterLocalAgentImage = async () => {
    setError(null);
    setIsRegisteringLocal(true);
    try {
      const img = await registerLocalImage({
        reference: "local:agent-ready",
        kernelPath: localKernelPath,
        rootfsPath: localRootfsPath,
      });

      setImages((prev) => {
        const next = prev.filter((x) => x.id !== img.id);
        return [img, ...next];
      });
      setImageId(img.id);
    } catch (err) {
      const message =
        err instanceof BonfireAPIError
          ? err.message
          : "Failed to register local agent image. Ensure the build script has been run.";
      setError(message);
    } finally {
      setIsRegisteringLocal(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      setError("VM name is required");
      return;
    }

    if (!imageId) {
      setError("Please select an image");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const vm = await createVM({
        name: name.trim(),
        vcpus,
        memoryMib,
        imageId,
      });
      onSuccess?.(vm);
    } catch (err) {
      const message =
        err instanceof BonfireAPIError ? err.message : "Failed to create VM. Please try again.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const formContent = (
    <>
      <div className="grid gap-4 py-4">
        <div className="grid gap-2">
          <Label htmlFor="name">
            Name <span className="text-destructive">*</span>
          </Label>
          <Input
            id="name"
            placeholder="e.g., my-vm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isLoading}
            className="min-h-[44px]"
            data-testid="vm-name-input"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label htmlFor="vcpus">vCPUs</Label>
            <Input
              id="vcpus"
              type="number"
              min={1}
              max={32}
              value={vcpus}
              onChange={(e) => setVcpus(parseInt(e.target.value) || 1)}
              disabled={isLoading}
              className="min-h-[44px]"
              data-testid="vm-vcpus-input"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="memory">Memory (MiB)</Label>
            <Input
              id="memory"
              type="number"
              min={128}
              max={32768}
              step={128}
              value={memoryMib}
              onChange={(e) => setMemoryMib(parseInt(e.target.value) || 512)}
              disabled={isLoading}
              className="min-h-[44px]"
              data-testid="vm-memory-input"
            />
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="image">
            Image <span className="text-destructive">*</span>
          </Label>

          <Card className="gap-4 py-4">
            <CardHeader className="px-4">
              <div className="flex items-start justify-between gap-3">
                <div className="grid gap-1">
                  <CardTitle className="text-base">Agent-ready local image</CardTitle>
                  <CardDescription>
                    Best for agent sessions. Generated by{" "}
                    <code className="font-mono">./scripts/build-agent-image-docker.sh</code>.
                  </CardDescription>
                </div>
                <Badge variant="secondary">Recommended</Badge>
              </div>
            </CardHeader>

            <CardContent className="px-4">
              <div className="grid gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="local-kernel" className="text-xs">
                    Kernel path
                  </Label>
                  <Input
                    id="local-kernel"
                    value={localKernelPath}
                    onChange={(e) => setLocalKernelPath(e.target.value)}
                    disabled={isLoading || isRegisteringLocal}
                    className="min-h-[40px] font-mono text-xs"
                    inputMode="text"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                </div>

                <div className="grid gap-1.5">
                  <Label htmlFor="local-rootfs" className="text-xs">
                    Rootfs path
                  </Label>
                  <Input
                    id="local-rootfs"
                    value={localRootfsPath}
                    onChange={(e) => setLocalRootfsPath(e.target.value)}
                    disabled={isLoading || isRegisteringLocal}
                    className="min-h-[40px] font-mono text-xs"
                    inputMode="text"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                </div>

                <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  If registration fails, the files probably don’t exist yet. Build the image first,
                  then try again.
                </div>
              </div>
            </CardContent>

            <Separator />

            <CardFooter className="flex flex-col items-stretch gap-2 px-4 sm:flex-row sm:items-center sm:justify-between">
              <Button
                type="button"
                variant="secondary"
                onClick={handleRegisterLocalAgentImage}
                disabled={
                  isLoading ||
                  isRegisteringLocal ||
                  !localKernelPath.trim() ||
                  !localRootfsPath.trim()
                }
                className="min-h-[40px]"
                data-testid="register-local-agent-image"
              >
                {isRegisteringLocal ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Registering...
                  </>
                ) : (
                  "Register"
                )}
              </Button>
              <Link to="/images" className="text-xs text-primary hover:underline">
                Manage images
              </Link>
            </CardFooter>
          </Card>

          <Select
            value={imageId}
            onValueChange={setImageId}
            disabled={isLoading || isFetchingImages || images.length === 0}
          >
            <SelectTrigger className="min-h-[44px] w-full" data-testid="vm-image-select">
              <SelectValue
                placeholder={
                  isFetchingImages
                    ? "Loading images..."
                    : images.length === 0
                      ? "No images available"
                      : "Select an image"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {images.map((image) => (
                <SelectItem key={image.id} value={image.id}>
                  {image.reference}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {images.length === 0 && !isFetchingImages && (
            <p className="text-xs text-muted-foreground">
              No images available.{" "}
              <Link to="/images" className="text-primary hover:underline">
                Pull an image first
              </Link>
              .
            </p>
          )}
        </div>

        {error && (
          <div
            className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
            data-testid="create-vm-error"
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
          disabled={isLoading || !name.trim() || !imageId}
          className="min-h-[44px] w-full sm:w-auto"
          data-testid="create-vm-submit"
        >
          {isLoading ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Creating...
            </>
          ) : (
            <>
              <Plus className="mr-2 size-4" />
              Create VM
            </>
          )}
        </Button>
      </div>
    </>
  );

  return <form onSubmit={handleSubmit}>{formContent}</form>;
}

export function CreateVMDialog({ onSuccess, children }: CreateVMDialogProps) {
  const [open, setOpen] = useState(false);
  const isDesktop = useMediaQuery("(min-width: 640px)");

  const handleSuccess = (vm: VM) => {
    onSuccess?.(vm);
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
            <Button className="min-h-[44px]" data-testid="create-vm-btn">
              <Plus className="mr-2 size-4" />
              Create VM
            </Button>
          )}
        </DialogTrigger>
        <DialogContent className="max-h-[85vh] overflow-hidden p-0 sm:max-w-lg">
          <div className="flex max-h-[85vh] flex-col">
            <DialogHeader className="px-6 pt-6 pb-4">
              <DialogTitle>Create Virtual Machine</DialogTitle>
              <DialogDescription>
                Create a new Firecracker microVM with the specified configuration.
              </DialogDescription>
            </DialogHeader>
            <div
              className="min-h-0 flex-1 overflow-y-auto px-6 pb-6"
              data-testid="create-vm-scroll"
            >
              <CreateVMForm onSuccess={handleSuccess} onCancel={() => setOpen(false)} />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer open={open} onOpenChange={handleOpenChange}>
      <DrawerTrigger asChild>
        {children || (
          <Button className="min-h-[44px]" data-testid="create-vm-btn">
            <Plus className="mr-2 size-4" />
            Create VM
          </Button>
        )}
      </DrawerTrigger>
      <DrawerContent className="h-[80vh] overflow-hidden">
        <DrawerHeader>
          <DrawerTitle>Create Virtual Machine</DrawerTitle>
          <DrawerDescription>
            Create a new Firecracker microVM with the specified configuration.
          </DrawerDescription>
        </DrawerHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4" data-testid="create-vm-scroll">
          <CreateVMForm onSuccess={handleSuccess} onCancel={() => setOpen(false)} />
        </div>
        <DrawerFooter />
      </DrawerContent>
    </Drawer>
  );
}
