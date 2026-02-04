/**
 * TAP Device Management Service
 *
 * System calls for creating and managing TAP devices.
 * These functions require root or NET_ADMIN capability.
 */

import { exec } from "child_process";
import { promisify } from "util";
import { generateMacAddress } from "./ip-pool";

// Allow dependency injection for testing
let execAsync = promisify(exec);

// Test helper to inject mock exec
export function __setExecAsync(mockExec: typeof execAsync): void {
  execAsync = mockExec;
}

// Test helper to reset exec
export function __resetExecAsync(): void {
  execAsync = promisify(exec);
}

// Get bridge name at runtime (allows testing with different values)
function getBridgeName(): string {
  return process.env.BONFIRE_BRIDGE || "bonfire0";
}

// TAP device naming prefix
// Note: Linux interface names are limited to 15 characters (IFNAMSIZ)
// tap-bf- (7) + first 8 chars of VM ID = 15 characters max
const TAP_PREFIX = "tap-bf-";

export interface TapDevice {
  tapName: string;
  macAddress: string;
}

/**
 * Generate a valid TAP device name from VM ID
 * Linux interface names are limited to 15 characters (IFNAMSIZ)
 */
function generateTapName(vmId: string): string {
  // Use first 8 characters of VM ID to stay within 15 char limit
  // tap-bf- (7) + 8 chars = 15 characters
  // Note: Keep hyphens as they are part of the VM ID format
  const shortId = vmId.substring(0, 8);
  return `${TAP_PREFIX}${shortId}`;
}

/**
 * Create a TAP device for a VM
 *
 * @param vmId - The unique VM identifier
 * @returns Object containing tap device name and MAC address
 * @throws Error if TAP creation fails (permission denied, bridge doesn't exist, etc.)
 */
export async function createTap(vmId: string): Promise<TapDevice> {
  const tapName = generateTapName(vmId);
  const macAddress = generateMacAddress(vmId);

  try {
    // 1. Create the TAP device
    await execAsync(`ip tuntap add dev ${tapName} mode tap`);

    // 2. Bring the TAP device up
    await execAsync(`ip link set dev ${tapName} up`);

    // 3. Attach TAP to bridge
    await execAsync(`ip link set dev ${tapName} master ${getBridgeName()}`);

    return { tapName, macAddress };
  } catch (error) {
    // Clean up if any step failed
    try {
      await deleteTap(tapName);
    } catch {
      // Ignore cleanup errors
    }

    if (error instanceof Error) {
      if (error.message.includes("Operation not permitted")) {
        throw new Error(
          `Permission denied: Cannot create TAP device. Requires root or NET_ADMIN capability.`,
          { cause: error }
        );
      }
      if (error.message.includes("No such device")) {
        throw new Error(`Bridge '${getBridgeName()}' does not exist. Run setup.sh first.`, {
          cause: error,
        });
      }
      throw new Error(`Failed to create TAP device: ${error.message}`, { cause: error });
    }
    throw new Error("Failed to create TAP device: Unknown error", { cause: error });
  }
}

/**
 * Delete a TAP device
 *
 * @param tapName - The name of the TAP device to delete
 * @throws Error if TAP deletion fails (permission denied, etc.)
 */
export async function deleteTap(tapName: string): Promise<void> {
  try {
    // 1. Remove TAP from bridge (ignore errors - may not be attached)
    try {
      await execAsync(`ip link set dev ${tapName} nomaster`);
    } catch {
      // Ignore - device might not be attached to bridge
    }

    // 2. Bring the TAP device down
    try {
      await execAsync(`ip link set dev ${tapName} down`);
    } catch {
      // Ignore - device might already be down or not exist
    }

    // 3. Delete the TAP device
    await execAsync(`ip tuntap del dev ${tapName} mode tap`);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("Operation not permitted")) {
        throw new Error(
          `Permission denied: Cannot delete TAP device. Requires root or NET_ADMIN capability.`,
          { cause: error }
        );
      }
      if (error.message.includes("No such device")) {
        // Device doesn't exist - this is fine, consider it deleted
        return;
      }
      throw new Error(`Failed to delete TAP device: ${error.message}`, { cause: error });
    }
    throw new Error("Failed to delete TAP device: Unknown error", { cause: error });
  }
}
