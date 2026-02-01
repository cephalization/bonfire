/**
 * Firecracker Socket Client
 *
 * HTTP client that communicates with Firecracker API over Unix domain sockets.
 * Based on Firecracker API spec v1.15.0.
 */

import { existsSync } from "fs";
import http from "http";

// Firecracker API types
export interface FirecrackerInstanceAction {
  action_type: "InstanceStart" | "FlushMetrics" | "SendCtrlAltDel";
}

export interface FirecrackerError {
  fault_message: string;
}

export interface FirecrackerInstanceInfo {
  app_name: string;
  id: string;
  state: "Not started" | "Running" | "Paused";
  vmm_version: string;
}

export interface VMConfiguration {
  machineConfig: {
    vcpu_count: number;
    mem_size_mib: number;
  };
  bootSource: {
    kernel_image_path: string;
    boot_args?: string;
    initrd_path?: string;
  };
  drives: Array<{
    drive_id: string;
    path_on_host: string;
    is_root_device: boolean;
    is_read_only: boolean;
  }>;
  networkInterfaces: Array<{
    iface_id: string;
    host_dev_name: string;
    guest_mac?: string;
  }>;
}

/**
 * Make an HTTP request to Firecracker API over Unix socket
 */
async function socketFetch(
  socketPath: string,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; data: unknown }> {
  const requestBody = body === undefined ? undefined : JSON.stringify(body);

  const result = await new Promise<{ status: number; text: string }>((resolve, reject) => {
    const req = http.request(
      {
        socketPath,
        method,
        path,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(requestBody ? { "Content-Length": Buffer.byteLength(requestBody) } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            text: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );

    req.on("error", reject);
    if (requestBody) req.write(requestBody);
    req.end();
  });

  let data: unknown;
  if (result.text) {
    try {
      data = JSON.parse(result.text);
    } catch {
      data = result.text;
    }
  }

  return { status: result.status, data };
}

/**
 * Configure VM machine settings
 */
export async function putMachineConfig(
  socketPath: string,
  config: { vcpu_count: number; mem_size_mib: number }
): Promise<void> {
  const { status, data } = await socketFetch(
    socketPath,
    "PUT",
    "/machine-config",
    config
  );

  if (status !== 204) {
    const error = data as FirecrackerError;
    throw new Error(
      `Failed to configure machine: ${error?.fault_message || `HTTP ${status}`}`
    );
  }
}

/**
 * Configure VM boot source
 */
export async function putBootSource(
  socketPath: string,
  config: {
    kernel_image_path: string;
    boot_args?: string;
    initrd_path?: string;
  }
): Promise<void> {
  const { status, data } = await socketFetch(
    socketPath,
    "PUT",
    "/boot-source",
    config
  );

  if (status !== 204) {
    const error = data as FirecrackerError;
    throw new Error(
      `Failed to configure boot source: ${error?.fault_message || `HTTP ${status}`}`
    );
  }
}

/**
 * Configure a drive
 */
export async function putDrive(
  socketPath: string,
  driveId: string,
  config: {
    drive_id: string;
    path_on_host: string;
    is_root_device: boolean;
    is_read_only: boolean;
  }
): Promise<void> {
  const { status, data } = await socketFetch(
    socketPath,
    "PUT",
    `/drives/${encodeURIComponent(driveId)}`,
    config
  );

  if (status !== 204) {
    const error = data as FirecrackerError;
    throw new Error(
      `Failed to configure drive ${driveId}: ${error?.fault_message || `HTTP ${status}`}`
    );
  }
}

/**
 * Configure a network interface
 */
export async function putNetworkInterface(
  socketPath: string,
  ifaceId: string,
  config: {
    iface_id: string;
    host_dev_name: string;
    guest_mac?: string;
  }
): Promise<void> {
  const { status, data } = await socketFetch(
    socketPath,
    "PUT",
    `/network-interfaces/${encodeURIComponent(ifaceId)}`,
    config
  );

  if (status !== 204) {
    const error = data as FirecrackerError;
    throw new Error(
      `Failed to configure network interface ${ifaceId}: ${error?.fault_message || `HTTP ${status}`}`
    );
  }
}

/**
 * Start the VM instance
 */
export async function startInstance(socketPath: string): Promise<void> {
  const { status, data } = await socketFetch(socketPath, "PUT", "/actions", {
    action_type: "InstanceStart",
  });

  if (status !== 204) {
    const error = data as FirecrackerError;
    throw new Error(
      `Failed to start instance: ${error?.fault_message || `HTTP ${status}`}`
    );
  }
}

/**
 * Send Ctrl+Alt+Del to the VM (graceful shutdown)
 */
export async function sendCtrlAltDel(socketPath: string): Promise<void> {
  const { status, data } = await socketFetch(socketPath, "PUT", "/actions", {
    action_type: "SendCtrlAltDel",
  });

  if (status !== 204) {
    const error = data as FirecrackerError;
    throw new Error(
      `Failed to send Ctrl+Alt+Del: ${error?.fault_message || `HTTP ${status}`}`
    );
  }
}

/**
 * Get instance information
 */
export async function getInstanceInfo(
  socketPath: string
): Promise<FirecrackerInstanceInfo> {
  const { status, data } = await socketFetch(socketPath, "GET", "/");

  if (status !== 200) {
    const error = data as FirecrackerError;
    throw new Error(
      `Failed to get instance info: ${error?.fault_message || `HTTP ${status}`}`
    );
  }

  return data as FirecrackerInstanceInfo;
}

/**
 * Configure all VM settings at once
 */
export async function configureVM(
  socketPath: string,
  config: VMConfiguration
): Promise<void> {
  // Configure machine (vCPUs, memory)
  await putMachineConfig(socketPath, config.machineConfig);

  // Configure boot source (kernel)
  await putBootSource(socketPath, config.bootSource);

  // Configure drives
  for (const drive of config.drives) {
    await putDrive(socketPath, drive.drive_id, drive);
  }

  // Configure network interfaces
  for (const iface of config.networkInterfaces) {
    await putNetworkInterface(socketPath, iface.iface_id, iface);
  }
}

/**
 * Check if Firecracker API is ready (socket is responsive)
 */
export async function isApiReady(socketPath: string): Promise<boolean> {
  try {
    // Check if socket file exists first using fs for reliability
    if (!existsSync(socketPath)) {
      return false;
    }

    // Try to connect to the socket
    const { status } = await socketFetch(socketPath, "GET", "/");
    return status === 200;
  } catch {
    // Socket not ready or connection failed
    return false;
  }
}

/**
 * Wait for Firecracker API to become ready
 */
export async function waitForApiReady(
  socketPath: string,
  timeoutMs = 10000,
  intervalMs = 100
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (await isApiReady(socketPath)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Firecracker API not ready after ${timeoutMs}ms`);
}
