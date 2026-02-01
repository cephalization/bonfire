/**
 * Firecracker Configuration Generation
 *
 * Pure functions to generate Firecracker API payloads.
 * Based on Firecracker API spec v1.15.0:
 * https://github.com/firecracker-microvm/firecracker/blob/main/src/firecracker/swagger/firecracker.yaml
 */

// ============================================================================
// Input Types (for our API)
// ============================================================================

export interface MachineConfigInput {
  vcpus: number;
  memoryMib: number;
}

export interface BootSourceInput {
  kernelPath: string;
  bootArgs?: string;
  initrdPath?: string;
}

export interface DriveInput {
  driveId: string;
  pathOnHost: string;
  isRootDevice: boolean;
  isReadOnly?: boolean;
}

export interface NetworkInterfaceInput {
  ifaceId?: string;
  tapDevice: string;
  macAddress?: string;
}

// ============================================================================
// Firecracker API Types (output payloads)
// ============================================================================

/**
 * Firecracker machine-config payload
 * PUT /machine-config
 */
export interface FirecrackerMachineConfig {
  vcpu_count: number;
  mem_size_mib: number;
  smt?: boolean;
  track_dirty_pages?: boolean;
}

/**
 * Firecracker boot-source payload
 * PUT /boot-source
 */
export interface FirecrackerBootSource {
  kernel_image_path: string;
  boot_args?: string;
  initrd_path?: string;
}

/**
 * Firecracker drive payload
 * PUT /drives/{drive_id}
 */
export interface FirecrackerDrive {
  drive_id: string;
  path_on_host: string;
  is_root_device: boolean;
  is_read_only: boolean;
  cache_type?: "Unsafe" | "Writeback";
}

/**
 * Firecracker network-interface payload
 * PUT /network-interfaces/{iface_id}
 */
export interface FirecrackerNetworkInterface {
  iface_id: string;
  host_dev_name: string;
  guest_mac?: string;
}

// ============================================================================
// Default Values
// ============================================================================

export const DEFAULTS = {
  vcpus: 1,
  memoryMib: 512,
  isReadOnly: false,
  ifaceId: "eth0",
} as const;

// ============================================================================
// Generator Functions
// ============================================================================

/**
 * Generates a Firecracker machine-config payload
 *
 * @param input - VM CPU and memory configuration
 * @returns Firecracker machine-config payload for PUT /machine-config
 */
export function generateMachineConfig(
  input: MachineConfigInput
): FirecrackerMachineConfig {
  const vcpuCount = input.vcpus ?? DEFAULTS.vcpus;
  const memSizeMib = input.memoryMib ?? DEFAULTS.memoryMib;

  if (vcpuCount < 1 || vcpuCount > 32) {
    throw new Error(`vcpu_count must be between 1 and 32, got ${vcpuCount}`);
  }

  if (memSizeMib < 1) {
    throw new Error(`mem_size_mib must be positive, got ${memSizeMib}`);
  }

  return {
    vcpu_count: vcpuCount,
    mem_size_mib: memSizeMib,
  };
}

/**
 * Generates a Firecracker boot-source payload
 *
 * @param input - Kernel and boot configuration
 * @returns Firecracker boot-source payload for PUT /boot-source
 */
export function generateBootSource(
  input: BootSourceInput
): FirecrackerBootSource {
  if (!input.kernelPath) {
    throw new Error("kernelPath is required");
  }

  const config: FirecrackerBootSource = {
    kernel_image_path: input.kernelPath,
  };

  if (input.bootArgs !== undefined) {
    config.boot_args = input.bootArgs;
  }

  if (input.initrdPath !== undefined) {
    config.initrd_path = input.initrdPath;
  }

  return config;
}

/**
 * Generates a Firecracker drive payload
 *
 * @param input - Drive configuration
 * @returns Firecracker drive payload for PUT /drives/{drive_id}
 */
export function generateDrive(input: DriveInput): FirecrackerDrive {
  if (!input.driveId) {
    throw new Error("driveId is required");
  }

  if (!input.pathOnHost) {
    throw new Error("pathOnHost is required");
  }

  return {
    drive_id: input.driveId,
    path_on_host: input.pathOnHost,
    is_root_device: input.isRootDevice,
    is_read_only: input.isReadOnly ?? DEFAULTS.isReadOnly,
  };
}

/**
 * Generates a Firecracker network-interface payload
 *
 * @param input - Network interface configuration
 * @returns Firecracker network-interface payload for PUT /network-interfaces/{iface_id}
 */
export function generateNetworkInterface(
  input: NetworkInterfaceInput
): FirecrackerNetworkInterface {
  if (!input.tapDevice) {
    throw new Error("tapDevice is required");
  }

  const config: FirecrackerNetworkInterface = {
    iface_id: input.ifaceId ?? DEFAULTS.ifaceId,
    host_dev_name: input.tapDevice,
  };

  if (input.macAddress !== undefined) {
    config.guest_mac = input.macAddress;
  }

  return config;
}
