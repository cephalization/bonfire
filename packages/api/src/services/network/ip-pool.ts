/**
 * IP Pool Management Service
 * 
 * Pure functions for IP allocation and MAC generation.
 * No system calls - fully unit testable.
 */

// IP range configuration
const NETWORK_PREFIX = '10.0.100';
const IP_START = 2;  // First usable IP (.0 is network, .1 is gateway)
const IP_END = 254;  // Last usable IP (.255 is broadcast)

/**
 * IP Pool class managing allocation of IP addresses
 */
export class IPPool {
  private allocated: Set<number>;
  private nextIp: number;

  constructor() {
    this.allocated = new Set();
    this.nextIp = IP_START;
  }

  /**
   * Allocate the next available IP address
   * @returns The allocated IP address string
   * @throws Error if pool is exhausted
   */
  allocate(): string {
    // First, try to find the next sequential IP
    while (this.nextIp <= IP_END && this.allocated.has(this.nextIp)) {
      this.nextIp++;
    }

    if (this.nextIp > IP_END) {
      // Pool exhausted - try to find any released IP
      for (let i = IP_START; i <= IP_END; i++) {
        if (!this.allocated.has(i)) {
          this.allocated.add(i);
          return this.formatIp(i);
        }
      }
      throw new Error('IP pool exhausted: no available IP addresses');
    }

    const ip = this.nextIp;
    this.allocated.add(ip);
    this.nextIp++;
    return this.formatIp(ip);
  }

  /**
   * Release an IP address back to the pool
   * @param ip - The IP address to release
   */
  release(ip: string): void {
    const octet = this.parseIp(ip);
    if (octet !== null) {
      this.allocated.delete(octet);
      // Reset nextIp to potentially reuse released IPs sooner
      if (octet < this.nextIp) {
        this.nextIp = octet;
      }
    }
  }

  /**
   * Check if an IP address is currently allocated
   * @param ip - The IP address to check
   * @returns true if the IP is allocated, false otherwise
   */
  isAllocated(ip: string): boolean {
    const octet = this.parseIp(ip);
    if (octet === null) return false;
    return this.allocated.has(octet);
  }

  /**
   * Get the number of currently allocated IPs
   */
  getAllocatedCount(): number {
    return this.allocated.size;
  }

  /**
   * Get the total capacity of the pool
   */
  getCapacity(): number {
    return IP_END - IP_START + 1;
  }

  private formatIp(octet: number): string {
    return `${NETWORK_PREFIX}.${octet}`;
  }

  private parseIp(ip: string): number | null {
    const match = ip.match(new RegExp(`^${NETWORK_PREFIX}\\.(\\d+)$`));
    if (!match) return null;
    const octet = parseInt(match[1], 10);
    if (octet < IP_START || octet > IP_END) return null;
    return octet;
  }
}

/**
 * Generate a deterministic MAC address from a VM ID
 * 
 * MAC format: 02:00:00:XX:XX:XX
 * - 02 prefix indicates locally administered unicast
 * - Remaining 3 bytes derived from VM ID hash
 * 
 * @param vmId - The unique VM identifier
 * @returns A deterministic MAC address string
 */
export function generateMacAddress(vmId: string): string {
  // Simple hash function for deterministic MAC generation
  let hash = 0;
  for (let i = 0; i < vmId.length; i++) {
    const char = vmId.charCodeAt(i);
    hash = ((hash << 5) - hash + char) & 0xFFFFFFFF;
  }

  // Use lower 24 bits for MAC (3 bytes)
  const byte1 = (hash >> 16) & 0xFF;
  const byte2 = (hash >> 8) & 0xFF;
  const byte3 = hash & 0xFF;

  // Format as MAC address with locally administered prefix
  const mac = [
    '02',
    '00',
    '00',
    byte1.toString(16).padStart(2, '0'),
    byte2.toString(16).padStart(2, '0'),
    byte3.toString(16).padStart(2, '0')
  ].join(':');

  return mac.toLowerCase();
}
