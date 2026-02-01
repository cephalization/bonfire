import { useEffect, useState, useCallback } from "react";
import { Trash2, Package, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  listImages,
  deleteImage,
  type Image,
  BonfireAPIError,
} from "@/lib/api";
import { PullImageDialog } from "@/components/PullImageDialog";

function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return "Unknown";
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface ImageCardProps {
  image: Image;
  onDelete: (id: string) => void;
  isDeleting: boolean;
}

function ImageCard({ image, onDelete, isDeleting }: ImageCardProps) {
  return (
    <Card
      className="overflow-hidden"
      data-testid={`image-card-${image.id}`}
    >
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-2">
          <CardTitle className="text-base break-all" title={image.reference}>
            {image.reference}
          </CardTitle>
          <CardDescription className="flex flex-col gap-1 sm:flex-row sm:gap-4">
            <span>Size: {formatBytes(image.sizeBytes)}</span>
            <span>Pulled: {formatDate(image.pulledAt)}</span>
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <Button
          variant="outline"
          size="sm"
          className="min-h-[36px] w-full border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive sm:w-auto"
          onClick={() => onDelete(image.id)}
          disabled={isDeleting}
          data-testid={`image-delete-btn-${image.id}`}
        >
          {isDeleting ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <Trash2 className="mr-2 size-4" />
          )}
          Delete
        </Button>
      </CardContent>
    </Card>
  );
}

export function Images() {
  const [images, setImages] = useState<Image[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingImages, setDeletingImages] = useState<Record<string, boolean>>({});

  const fetchImages = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await listImages();
      setImages(data);
    } catch (err) {
      const message =
        err instanceof BonfireAPIError
          ? err.message
          : "Failed to fetch images. Please try again.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchImages();
  }, [fetchImages]);

  const handleDelete = async (id: string) => {
    setDeletingImages((prev) => ({ ...prev, [id]: true }));
    try {
      await deleteImage(id);
      await fetchImages();
    } catch (err) {
      const message =
        err instanceof BonfireAPIError ? err.message : "Failed to delete image";
      setError(message);
    } finally {
      setDeletingImages((prev) => ({ ...prev, [id]: false }));
    }
  };

  const handlePullSuccess = () => {
    fetchImages();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Images</h1>
          <p className="text-muted-foreground">
            Manage your cached container images
          </p>
        </div>
        <PullImageDialog onSuccess={handlePullSuccess}>
          <Button className="min-h-[44px] w-full sm:w-auto" data-testid="pull-image-btn">
            Pull Image
          </Button>
        </PullImageDialog>
      </div>

      {/* Error Alert */}
      {error && (
        <div
          className="flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive"
          data-testid="images-error"
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

      {/* Images List */}
      {isLoading ? (
        <div
          className="flex flex-col items-center justify-center py-12"
          data-testid="images-loading"
        >
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
          <p className="mt-4 text-sm text-muted-foreground">Loading images...</p>
        </div>
      ) : images.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center"
          data-testid="images-empty"
        >
          <div className="flex size-16 items-center justify-center rounded-full bg-muted">
            <Package className="size-8 text-muted-foreground" />
          </div>
          <h3 className="mt-4 text-lg font-semibold">No images yet</h3>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Pull your first container image to get started with Bonfire.
          </p>
          <PullImageDialog onSuccess={handlePullSuccess}>
            <Button className="mt-4 min-h-[44px]" data-testid="pull-image-btn-empty">
              Pull Image
            </Button>
          </PullImageDialog>
        </div>
      ) : (
        <div
          className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2"
          data-testid="images-list"
        >
          {images.map((image) => (
            <ImageCard
              key={image.id}
              image={image}
              onDelete={handleDelete}
              isDeleting={deletingImages[image.id] || false}
            />
          ))}
        </div>
      )}
    </div>
  );
}
