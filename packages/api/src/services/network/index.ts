/**
 * Network Service
 *
 * Combined service for IP pool management and TAP device operations.
 * Dependency injection pattern allows for easy testing.
 */

import { IPPool, generateMacAddress } from "./ip-pool";
import { createTap, deleteTap, TapDevice } from "./tap";

export interface NetworkServiceConfig {
  ipPool?: IPPool;
  createTapFn?: typeof createTap;
  deleteTapFn?: typeof deleteTap;
}

export interface NetworkResources {
  tapDevice: string;
  macAddress: string;
  ipAddress: string;
}

/**
 * NetworkService combines IP pool and TAP device management
 */
export class NetworkService {
  private ipPool: IPPool;
  private createTapFn: typeof createTap;
  private deleteTapFn: typeof deleteTap;

  constructor(config: NetworkServiceConfig = {}) {
    this.ipPool = config.ipPool || new IPPool();
    this.createTapFn = config.createTapFn || createTap;
    this.deleteTapFn = config.deleteTapFn || deleteTap;
  }

  /**
   * Allocate network resources for a VM
   *
   * Creates TAP device and allocates IP address.
   *
   * @param vmId - The unique VM identifier
   * @returns Network resources for the VM
   * @throws Error if resource allocation fails
   */
  async allocate(vmId: string): Promise<NetworkResources> {
    // Allocate IP first (pure function, no cleanup needed on failure)
    const ipAddress = this.ipPool.allocate();

    try {
      // Create TAP device (system call)
      const { tapName, macAddress } = await this.createTapFn(vmId);

      return {
        tapDevice: tapName,
        macAddress,
        ipAddress,
      };
    } catch (error) {
      // Release the IP if TAP creation failed
      this.ipPool.release(ipAddress);
      throw error;
    }
  }

  /**
   * Release network resources for a VM
   *
   * Deletes TAP device and releases IP address.
   *
   * @param resources - The network resources to release
   * @throws Error if resource release fails
   */
  async release(resources: Partial<NetworkResources>): Promise<void> {
    // Delete TAP device (ignore errors - best effort cleanup)
    if (resources.tapDevice) {
      try {
        await this.deleteTapFn(resources.tapDevice);
      } catch {
        // Ignore cleanup errors
      }
    }

    // Release IP address
    if (resources.ipAddress) {
      this.ipPool.release(resources.ipAddress);
    }
  }

  /**
   * Get the underlying IP pool instance
   * Useful for testing and introspection
   */
  getIPPool(): IPPool {
    return this.ipPool;
  }
}

// Re-export types and functions for convenience
export { IPPool, generateMacAddress } from "./ip-pool";
export { createTap, deleteTap } from "./tap";
export type { TapDevice } from "./tap";
