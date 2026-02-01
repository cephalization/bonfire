/**
 * Images API Routes
 *
 * REST endpoints for image management:
 * - GET /api/images - List all cached images
 * - POST /api/images/pull - Pull image from registry
 * - DELETE /api/images/:id - Delete cached image
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import { images, vms } from "../db/schema";
import { RegistryService } from "../services/registry";
import { QuickStartService } from "../services/quickstart";

// ============================================================================
// OpenAPI Schemas
// ============================================================================

const ImageSchema = z
  .object({
    id: z.string().openapi({
      example: "abc123...",
      description: "Unique image ID (SHA256 of reference)",
    }),
    reference: z.string().openapi({
      example: "ghcr.io/openfaasltd/slicer-systemd:5.10.240-x86_64-latest",
      description: "Full image reference",
    }),
    kernelPath: z.string().openapi({
      example: "/var/lib/bonfire/images/abc123/kernel",
      description: "Path to kernel file",
    }),
    rootfsPath: z.string().openapi({
      example: "/var/lib/bonfire/images/abc123/rootfs",
      description: "Path to rootfs file",
    }),
    sizeBytes: z.number().nullable().openapi({
      example: 104857600,
      description: "Total size in bytes",
    }),
    pulledAt: z.string().datetime().openapi({
      example: "2024-01-15T10:30:00Z",
      description: "When the image was pulled",
    }),
  })
  .openapi("Image");

const PullImageRequestSchema = z
  .object({
    reference: z.string().optional().openapi({
      example: "ghcr.io/openfaasltd/slicer-systemd:5.10.240-x86_64-latest",
      description: "Image reference to pull",
    }),
  })
  .openapi("PullImageRequest");

const SuccessResponseSchema = z
  .object({
    success: z.boolean().openapi({
      example: true,
      description: "Whether the operation succeeded",
    }),
  })
  .openapi("SuccessResponse");

const ErrorResponseSchema = z
  .object({
    error: z.string().openapi({
      example: "Image not found",
      description: "Error message",
    }),
  })
  .openapi("ErrorResponse");

// ============================================================================
// Route Definitions
// ============================================================================

const listImagesRoute = createRoute({
  method: "get",
  path: "/images",
  tags: ["Images"],
  summary: "List cached images",
  description: "Returns all cached images from the database",
  responses: {
    200: {
      description: "List of images",
      content: {
        "application/json": {
          schema: z.array(ImageSchema),
        },
      },
    },
    500: {
      description: "Internal server error",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

const pullImageRoute = createRoute({
  method: "post",
  path: "/images/pull",
  tags: ["Images"],
  summary: "Pull image from registry",
  description: "Pulls an OCI image from a registry and caches it locally",
  request: {
    body: {
      content: {
        "application/json": {
          schema: PullImageRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Image pulled successfully",
      content: {
        "application/json": {
          schema: ImageSchema,
        },
      },
    },
    400: {
      description: "Invalid request",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
    500: {
      description: "Failed to pull image",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

const deleteImageRoute = createRoute({
  method: "delete",
  path: "/images/{id}",
  tags: ["Images"],
  summary: "Delete cached image",
  description: "Removes a cached image from disk and database. Cannot delete if VMs are using it.",
  request: {
    params: z.object({
      id: z.string().openapi({
        example: "abc123...",
        description: "Image ID",
      }),
    }),
  },
  responses: {
    200: {
      description: "Image deleted successfully",
      content: {
        "application/json": {
          schema: SuccessResponseSchema,
        },
      },
    },
    400: {
      description: "Image is in use by VMs",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
    404: {
      description: "Image not found",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
    500: {
      description: "Internal server error",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

const quickStartRoute = createRoute({
  method: "post",
  path: "/images/quickstart",
  tags: ["Images"],
  summary: "Download quick start image",
  description: "Downloads Firecracker's public test images from S3 for quick evaluation",
  responses: {
    201: {
      description: "Quick start image downloaded successfully",
      content: {
        "application/json": {
          schema: ImageSchema,
        },
      },
    },
    500: {
      description: "Failed to download quick start image",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// ============================================================================
// Router Factory
// ============================================================================

export interface ImagesRouterConfig {
  db: BetterSQLite3Database<typeof schema>;
  registryService?: RegistryService;
  quickStartService?: QuickStartService;
}

export function createImagesRouter(config: ImagesRouterConfig): OpenAPIHono {
  const app = new OpenAPIHono();
  const { db } = config;

  // Create registry service if not provided
  const registryService =
    config.registryService ??
    new RegistryService({
      db,
    });

  // Create quickstart service if not provided
  const quickStartService =
    config.quickStartService ??
    new QuickStartService({
      db,
    });

  // GET /api/images - List all cached images
  app.openapi(listImagesRoute, async (c) => {
    try {
      const allImages = await db.select().from(images);

      // Convert Date objects to ISO strings for JSON serialization
      const response = allImages.map((img) => ({
        ...img,
        pulledAt: img.pulledAt.toISOString(),
      }));

      return c.json(response, 200);
    } catch (error) {
      console.error("Failed to list images:", error);
      return c.json({ error: "Failed to list images" }, 500);
    }
  });

  // POST /api/images/pull - Pull image from registry
  app.openapi(pullImageRoute, async (c) => {
    try {
      const body = await c.req.json();
      const { reference } = body;

      if (!reference || typeof reference !== "string") {
        return c.json({ error: "Reference is required" }, 400);
      }

      const image = await registryService.pullImage(reference);

      // Convert Date to ISO string for JSON
      return c.json(
        {
          ...image,
          pulledAt: image.pulledAt.toISOString(),
        },
        201
      );
    } catch (error) {
      console.error("Failed to pull image:", error);
      const message = error instanceof Error ? error.message : "Failed to pull image";
      return c.json({ error: message }, 500);
    }
  });

  // DELETE /api/images/:id - Delete cached image
  app.openapi(deleteImageRoute, async (c) => {
    try {
      const id = c.req.param("id");

      // Check if image exists
      const [image] = await db.select().from(images).where(eq(images.id, id));

      if (!image) {
        return c.json({ error: "Image not found" }, 404);
      }

      // Check if any VMs are using this image
      const vmsUsingImage = await db.select().from(vms).where(eq(vms.imageId, id));

      if (vmsUsingImage.length > 0) {
        return c.json(
          {
            error: `Cannot delete image: in use by ${vmsUsingImage.length} VM(s)`,
          },
          400
        );
      }

      // Delete the image
      await registryService.deleteImage(id);

      return c.json({ success: true }, 200);
    } catch (error) {
      console.error("Failed to delete image:", error);
      const message = error instanceof Error ? error.message : "Failed to delete image";
      return c.json({ error: message }, 500);
    }
  });

  // POST /api/images/quickstart - Download quick start image
  app.openapi(quickStartRoute, async (c) => {
    try {
      const image = await quickStartService.downloadQuickStartImage();

      // Convert Date to ISO string for JSON
      return c.json(
        {
          ...image,
          pulledAt: image.pulledAt.toISOString(),
        },
        201
      );
    } catch (error) {
      console.error("Failed to download quick start image:", error);
      const message =
        error instanceof Error ? error.message : "Failed to download quick start image";
      return c.json({ error: message }, 500);
    }
  });

  return app;
}
