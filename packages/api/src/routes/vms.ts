/**
 * VMs API Routes
 *
 * REST endpoints for VM management:
 * - GET /api/vms - List all VMs
 * - POST /api/vms - Create VM record
 * - GET /api/vms/:id - Get single VM details
 * - DELETE /api/vms/:id - Delete VM record
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import * as schema from "../db/schema";
import { vms } from "../db/schema";
import { NetworkService } from "../services/network";
import {
  spawnFirecracker,
  configureVMProcess,
  startVMProcess,
  stopVMProcess,
  type FirecrackerProcess,
} from "../services/firecracker/process";
import type { VMConfiguration } from "../services/firecracker/socket-client";

// ============================================================================
// OpenAPI Schemas
// ============================================================================

const VMSchema = z
  .object({
    id: z.string().openapi({
      example: "vm-abc123",
      description: "Unique VM ID (UUID)",
    }),
    name: z.string().openapi({
      example: "my-vm",
      description: "VM name (unique)",
    }),
    status: z.enum(["creating", "running", "stopped", "error"]).openapi({
      example: "creating",
      description: "Current VM status",
    }),
    vcpus: z.number().openapi({
      example: 2,
      description: "Number of vCPUs",
    }),
    memoryMib: z.number().openapi({
      example: 1024,
      description: "Memory in MiB",
    }),
    imageId: z.string().nullable().openapi({
      example: "img-abc123",
      description: "Associated image ID",
    }),
    pid: z.number().nullable().openapi({
      example: 1234,
      description: "Firecracker process PID (when running)",
    }),
    socketPath: z.string().nullable().openapi({
      example: "/var/lib/bonfire/vms/vm-abc123/firecracker.sock",
      description: "Firecracker socket path",
    }),
    tapDevice: z.string().nullable().openapi({
      example: "tap-vm-abc123",
      description: "TAP device name",
    }),
    macAddress: z.string().nullable().openapi({
      example: "02:00:00:00:00:01",
      description: "MAC address",
    }),
    ipAddress: z.string().nullable().openapi({
      example: "192.168.100.10",
      description: "IP address",
    }),
    createdAt: z.string().datetime().openapi({
      example: "2024-01-15T10:30:00Z",
      description: "Creation timestamp",
    }),
    updatedAt: z.string().datetime().openapi({
      example: "2024-01-15T10:30:00Z",
      description: "Last update timestamp",
    }),
  })
  .openapi("VM");

const CreateVMRequestSchema = z
  .object({
    name: z.string().min(1).max(64).openapi({
      example: "my-vm",
      description: "VM name (required, unique)",
    }),
    vcpus: z.number().int().min(1).max(32).default(1).openapi({
      example: 2,
      description: "Number of vCPUs (1-32, default: 1)",
    }),
    memoryMib: z.number().int().min(128).max(65536).default(512).openapi({
      example: 1024,
      description: "Memory in MiB (128-65536, default: 512)",
    }),
    imageId: z.string().openapi({
      example: "img-abc123",
      description: "Image ID to use for the VM (required)",
    }),
  })
  .openapi("CreateVMRequest");

const ErrorResponseSchema = z
  .object({
    error: z.string().openapi({
      example: "VM not found",
      description: "Error message",
    }),
  })
  .openapi("ErrorResponse");

const ValidationErrorSchema = z
  .object({
    error: z.string(),
    details: z.array(
      z.object({
        path: z.array(z.string()),
        message: z.string(),
      })
    ),
  })
  .openapi("ValidationError");

// NOTE: Agent-based exec, health, and file copy endpoints have been deprecated
// in favor of serial console communication. See /api/vms/:id/terminal

// ============================================================================
// Route Definitions
// ============================================================================

const listVMsRoute = createRoute({
  method: "get",
  path: "/vms",
  tags: ["VMs"],
  summary: "List all VMs",
  description: "Returns all VMs from the database",
  responses: {
    200: {
      description: "List of VMs",
      content: {
        "application/json": {
          schema: z.array(VMSchema),
        },
      },
    },
    401: {
      description: "Unauthorized",
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

const createVMRoute = createRoute({
  method: "post",
  path: "/vms",
  tags: ["VMs"],
  summary: "Create a new VM",
  description: "Creates a new VM record with status 'creating'",
  request: {
    body: {
      content: {
        "application/json": {
          schema: CreateVMRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "VM created successfully",
      content: {
        "application/json": {
          schema: VMSchema,
        },
      },
    },
    400: {
      description: "Validation error",
      content: {
        "application/json": {
          schema: ValidationErrorSchema,
        },
      },
    },
    401: {
      description: "Unauthorized",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
    409: {
      description: "VM with this name already exists",
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

const getVMRoute = createRoute({
  method: "get",
  path: "/vms/{id}",
  tags: ["VMs"],
  summary: "Get VM details",
  description: "Returns details for a single VM",
  request: {
    params: z.object({
      id: z.string().openapi({
        example: "vm-abc123",
        description: "VM ID",
      }),
    }),
  },
  responses: {
    200: {
      description: "VM details",
      content: {
        "application/json": {
          schema: VMSchema,
        },
      },
    },
    401: {
      description: "Unauthorized",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
    404: {
      description: "VM not found",
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

const deleteVMRoute = createRoute({
  method: "delete",
  path: "/vms/{id}",
  tags: ["VMs"],
  summary: "Delete a VM",
  description: "Deletes a VM record. VM must be stopped first if running.",
  request: {
    params: z.object({
      id: z.string().openapi({
        example: "vm-abc123",
        description: "VM ID",
      }),
    }),
  },
  responses: {
    200: {
      description: "VM deleted successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
          }),
        },
      },
    },
    400: {
      description: "VM is running and must be stopped first",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: "Unauthorized",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
    404: {
      description: "VM not found",
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

const startVMRoute = createRoute({
  method: "post",
  path: "/vms/{id}/start",
  tags: ["VMs"],
  summary: "Start a VM",
  description:
    "Starts a VM by allocating network resources and spawning Firecracker process. VM must be in 'creating' or 'stopped' status.",
  request: {
    params: z.object({
      id: z.string().openapi({
        example: "vm-abc123",
        description: "VM ID",
      }),
    }),
  },
  responses: {
    200: {
      description: "VM started successfully",
      content: {
        "application/json": {
          schema: VMSchema,
        },
      },
    },
    400: {
      description: "VM cannot be started from current status",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
    404: {
      description: "VM not found",
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

const stopVMRoute = createRoute({
  method: "post",
  path: "/vms/{id}/stop",
  tags: ["VMs"],
  summary: "Stop a VM",
  description:
    "Stops a running VM by stopping Firecracker process and releasing network resources. VM must be in 'running' status.",
  request: {
    params: z.object({
      id: z.string().openapi({
        example: "vm-abc123",
        description: "VM ID",
      }),
    }),
  },
  responses: {
    200: {
      description: "VM stopped successfully",
      content: {
        "application/json": {
          schema: VMSchema,
        },
      },
    },
    400: {
      description: "VM is not running",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
    404: {
      description: "VM not found",
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

// NOTE: execVMRoute, healthVMRoute, uploadVMRoute, and downloadVMRoute have been
// deprecated in favor of serial console communication via /api/vms/:id/terminal

// ============================================================================
// Router Factory
// ============================================================================

export interface VMsRouterConfig {
  db: BetterSQLite3Database<typeof schema>;
  networkService?: NetworkService;
  spawnFirecrackerFn?: typeof spawnFirecracker;
  configureVMProcessFn?: typeof configureVMProcess;
  startVMProcessFn?: typeof startVMProcess;
  stopVMProcessFn?: typeof stopVMProcess;
}

export function createVMsRouter(config: VMsRouterConfig): OpenAPIHono {
  const app = new OpenAPIHono();
  const { db } = config;

  // Create services if not provided (allows for dependency injection in tests)
  const networkService = config.networkService ?? new NetworkService();
  const spawnFirecrackerFn = config.spawnFirecrackerFn ?? spawnFirecracker;
  const configureVMProcessFn = config.configureVMProcessFn ?? configureVMProcess;
  const startVMProcessFn = config.startVMProcessFn ?? startVMProcess;
  const stopVMProcessFn = config.stopVMProcessFn ?? stopVMProcess;

  // Helper to serialize VM for JSON response
  function serializeVM(vm: typeof schema.vms.$inferSelect) {
    return {
      ...vm,
      createdAt: new Date(vm.createdAt).toISOString(),
      updatedAt: new Date(vm.updatedAt).toISOString(),
    };
  }

  // GET /api/vms - List all VMs
  app.openapi(listVMsRoute, async (c) => {
    try {
      const allVMs = await db.select().from(vms);
      return c.json(allVMs.map(serializeVM), 200);
    } catch (error) {
      console.error("Failed to list VMs:", error);
      return c.json({ error: "Failed to list VMs" }, 500);
    }
  });

  // POST /api/vms - Create VM record
  app.openapi(createVMRoute, async (c) => {
    try {
      const body = await c.req.json();

      // Validate request body manually since OpenAPIHono validation can be bypassed
      const validationResult = CreateVMRequestSchema.safeParse(body);
      if (!validationResult.success) {
        const errors = validationResult.error.issues.map((issue) => ({
          path: issue.path.map(String),
          message: issue.message,
        }));
        return c.json(
          {
            error: "Validation failed",
            details: errors,
          },
          400
        );
      }

      const { name, vcpus, memoryMib, imageId } = validationResult.data;

      // Check if VM with this name already exists
      const existingVM = await db.select().from(vms).where(eq(vms.name, name));
      if (existingVM.length > 0) {
        return c.json({ error: `VM with name '${name}' already exists` }, 409);
      }

      // Generate UUID for the VM
      const vmId = randomUUID();
      const now = new Date();

      // Create VM record
      const newVM = {
        id: vmId,
        name,
        status: "creating" as const,
        vcpus: vcpus ?? 1,
        memoryMib: memoryMib ?? 512,
        imageId,
        pid: null,
        socketPath: null,
        tapDevice: null,
        macAddress: null,
        ipAddress: null,
        createdAt: now,
        updatedAt: now,
      };

      await db.insert(vms).values(newVM);

      return c.json(serializeVM(newVM), 201);
    } catch (error) {
      console.error("Failed to create VM:", error);
      const message = error instanceof Error ? error.message : "Failed to create VM";
      return c.json({ error: message }, 500);
    }
  });

  // GET /api/vms/:id - Get single VM details
  app.openapi(getVMRoute, async (c) => {
    try {
      const id = c.req.param("id");

      const [vm] = await db.select().from(vms).where(eq(vms.id, id));

      if (!vm) {
        return c.json({ error: "VM not found" }, 404);
      }

      return c.json(serializeVM(vm), 200);
    } catch (error) {
      console.error("Failed to get VM:", error);
      return c.json({ error: "Failed to get VM" }, 500);
    }
  });

  // DELETE /api/vms/:id - Delete VM record
  app.openapi(deleteVMRoute, async (c) => {
    try {
      const id = c.req.param("id");

      // Check if VM exists
      const [vm] = await db.select().from(vms).where(eq(vms.id, id));

      if (!vm) {
        return c.json({ error: "VM not found" }, 404);
      }

      // Check if VM is running - must stop first
      if (vm.status === "running") {
        return c.json({ error: "VM is running. Stop it before deleting." }, 400);
      }

      // Clean up network resources if they exist
      if (vm.tapDevice || vm.ipAddress) {
        try {
          await networkService.release({
            tapDevice: vm.tapDevice ?? undefined,
            ipAddress: vm.ipAddress ?? undefined,
          });
        } catch (error) {
          console.warn(`Failed to release network resources for VM ${id}:`, error);
          // Continue with deletion even if cleanup fails
        }
      }

      // Delete the VM record
      await db.delete(vms).where(eq(vms.id, id));

      return c.json({ success: true }, 200);
    } catch (error) {
      console.error("Failed to delete VM:", error);
      const message = error instanceof Error ? error.message : "Failed to delete VM";
      return c.json({ error: message }, 500);
    }
  });

  // POST /api/vms/:id/start - Start a VM
  app.openapi(startVMRoute, async (c) => {
    try {
      const id = c.req.param("id");

      // Get VM from DB
      const [vm] = await db.select().from(vms).where(eq(vms.id, id));

      if (!vm) {
        return c.json({ error: "VM not found" }, 404);
      }

      // Verify VM can be started
      if (vm.status !== "stopped" && vm.status !== "creating") {
        return c.json(
          {
            error: `VM cannot be started from status '${vm.status}'. Must be 'stopped' or 'creating'.`,
          },
          400
        );
      }

      // Get image details for kernel and rootfs paths
      const [image] = await db
        .select()
        .from(schema.images)
        .where(eq(schema.images.id, vm.imageId ?? ""));
      if (!image) {
        return c.json({ error: "VM image not found" }, 400);
      }

      // 1. Allocate network resources (TAP device, IP, MAC)
      const networkResources = await networkService.allocate(id);

      let firecrackerProcess: FirecrackerProcess;
      try {
        // 2. Spawn Firecracker process
        firecrackerProcess = await spawnFirecrackerFn({ vmId: id });

        // 3. Configure the VM
        const vmConfig: VMConfiguration = {
          machineConfig: {
            vcpu_count: vm.vcpus,
            mem_size_mib: vm.memoryMib,
          },
          bootSource: {
            kernel_image_path: image.kernelPath,
            boot_args: "console=ttyS0 reboot=k panic=1 pci=off",
          },
          drives: [
            {
              drive_id: "rootfs",
              path_on_host: image.rootfsPath,
              is_root_device: true,
              is_read_only: false,
            },
          ],
          networkInterfaces: [
            {
              iface_id: "eth0",
              host_dev_name: networkResources.tapDevice,
              guest_mac: networkResources.macAddress,
            },
          ],
        };

        await configureVMProcessFn(firecrackerProcess.socketPath, vmConfig);

        // 4. Start the VM
        await startVMProcessFn(firecrackerProcess.socketPath);
      } catch (error) {
        // Cleanup network resources on failure
        await networkService.release(networkResources);
        throw error;
      }

      // 5. Update DB with running status and runtime info
      const now = new Date();
      const updatedVM = {
        ...vm,
        status: "running" as const,
        pid: firecrackerProcess.pid,
        socketPath: firecrackerProcess.socketPath,
        tapDevice: networkResources.tapDevice,
        macAddress: networkResources.macAddress,
        ipAddress: networkResources.ipAddress,
        updatedAt: now,
      };

      await db
        .update(vms)
        .set({
          status: updatedVM.status,
          pid: updatedVM.pid,
          socketPath: updatedVM.socketPath,
          tapDevice: updatedVM.tapDevice,
          macAddress: updatedVM.macAddress,
          ipAddress: updatedVM.ipAddress,
          updatedAt: updatedVM.updatedAt,
        })
        .where(eq(vms.id, id));

      return c.json(serializeVM(updatedVM), 200);
    } catch (error) {
      console.error("Failed to start VM:", error);
      const message = error instanceof Error ? error.message : "Failed to start VM";
      return c.json({ error: message }, 500);
    }
  });

  // POST /api/vms/:id/stop - Stop a VM
  app.openapi(stopVMRoute, async (c) => {
    try {
      const id = c.req.param("id");

      // Get VM from DB
      const [vm] = await db.select().from(vms).where(eq(vms.id, id));

      if (!vm) {
        return c.json({ error: "VM not found" }, 404);
      }

      // Verify VM is running
      if (vm.status !== "running") {
        return c.json({ error: `VM is not running. Current status: '${vm.status}'.` }, 400);
      }

      // VM must have runtime info to stop
      if (!vm.pid || !vm.socketPath) {
        return c.json({ error: "VM is missing runtime information" }, 500);
      }

      // 1. Stop the Firecracker process
      await stopVMProcessFn(vm.socketPath, vm.pid);

      // 2. Release network resources
      await networkService.release({
        tapDevice: vm.tapDevice ?? undefined,
        ipAddress: vm.ipAddress ?? undefined,
      });

      // 3. Update DB with stopped status and clear runtime fields
      const now = new Date();
      const updatedVM = {
        ...vm,
        status: "stopped" as const,
        pid: null,
        socketPath: null,
        tapDevice: null,
        macAddress: null,
        ipAddress: null,
        updatedAt: now,
      };

      await db
        .update(vms)
        .set({
          status: updatedVM.status,
          pid: updatedVM.pid,
          socketPath: updatedVM.socketPath,
          tapDevice: updatedVM.tapDevice,
          macAddress: updatedVM.macAddress,
          ipAddress: updatedVM.ipAddress,
          updatedAt: updatedVM.updatedAt,
        })
        .where(eq(vms.id, id));

      return c.json(serializeVM(updatedVM), 200);
    } catch (error) {
      console.error("Failed to stop VM:", error);
      const message = error instanceof Error ? error.message : "Failed to stop VM";
      return c.json({ error: message }, 500);
    }
  });

  // NOTE: Agent-based exec, health, upload, and download endpoints have been deprecated
  // in favor of serial console communication via /api/vms/:id/terminal

  return app;
}
