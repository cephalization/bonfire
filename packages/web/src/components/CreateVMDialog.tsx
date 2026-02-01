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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createVM, listImages, type VM, type Image, BonfireAPIError } from "@/lib/api";

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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchImages = async () => {
      setIsFetchingImages(true);
      try {
        const data = await listImages();
        setImages(data);
      } catch (err) {
        console.error("Failed to fetch images:", err);
      } finally {
        setIsFetchingImages(false);
      }
    };

    fetchImages();
  }, []);

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
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Virtual Machine</DialogTitle>
            <DialogDescription>
              Create a new Firecracker microVM with the specified configuration.
            </DialogDescription>
          </DialogHeader>
          <CreateVMForm onSuccess={handleSuccess} onCancel={() => setOpen(false)} />
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
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Create Virtual Machine</DrawerTitle>
          <DrawerDescription>
            Create a new Firecracker microVM with the specified configuration.
          </DrawerDescription>
        </DrawerHeader>
        <div className="px-4">
          <CreateVMForm onSuccess={handleSuccess} onCancel={() => setOpen(false)} />
        </div>
        <DrawerFooter />
      </DrawerContent>
    </Drawer>
  );
}
