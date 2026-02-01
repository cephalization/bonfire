/**
 * IP Pool Management Service Tests
 */
import { describe, expect, it } from "vitest";
import { IPPool, generateMacAddress } from "./ip-pool";

describe("IPPool", () => {
  describe("allocate", () => {
    it("should allocate sequential IPs starting at 10.0.100.2", () => {
      const pool = new IPPool();

      expect(pool.allocate()).toBe("10.0.100.2");
      expect(pool.allocate()).toBe("10.0.100.3");
      expect(pool.allocate()).toBe("10.0.100.4");
    });

    it("should throw on pool exhaustion", () => {
      const pool = new IPPool();
      const capacity = pool.getCapacity();

      // Allocate all IPs
      for (let i = 0; i < capacity; i++) {
        pool.allocate();
      }

      // Next allocation should throw
      expect(() => pool.allocate()).toThrow("IP pool exhausted");
    });
  });

  describe("release", () => {
    it("should allow released IPs to be reallocated", () => {
      const pool = new IPPool();

      // Allocate some IPs
      const ip1 = pool.allocate(); // 10.0.100.2
      const ip2 = pool.allocate(); // 10.0.100.3

      // Release the first IP
      pool.release(ip1);

      // Reallocation should give us the released IP
      const reallocated = pool.allocate();
      expect(reallocated).toBe(ip1);

      // Next allocation should continue from where we left off
      const ip3 = pool.allocate();
      expect(ip3).toBe("10.0.100.4");
    });

    it("should handle releasing non-existent IPs gracefully", () => {
      const pool = new IPPool();

      // Should not throw
      expect(() => pool.release("10.0.100.2")).not.toThrow();
      expect(() => pool.release("invalid-ip")).not.toThrow();
      expect(() => pool.release("192.168.1.1")).not.toThrow();
    });
  });

  describe("isAllocated", () => {
    it("should return true for allocated IPs", () => {
      const pool = new IPPool();
      const ip = pool.allocate();

      expect(pool.isAllocated(ip)).toBe(true);
    });

    it("should return false for unallocated IPs", () => {
      const pool = new IPPool();

      expect(pool.isAllocated("10.0.100.2")).toBe(false);
      expect(pool.isAllocated("10.0.100.100")).toBe(false);
    });

    it("should return false for IPs outside the pool range", () => {
      const pool = new IPPool();

      expect(pool.isAllocated("10.0.100.1")).toBe(false); // Gateway
      expect(pool.isAllocated("10.0.100.255")).toBe(false); // Broadcast
      expect(pool.isAllocated("192.168.1.1")).toBe(false); // Wrong network
    });

    it("should return false for invalid IP formats", () => {
      const pool = new IPPool();

      expect(pool.isAllocated("invalid")).toBe(false);
      expect(pool.isAllocated("")).toBe(false);
    });

    it("should return false after releasing an IP", () => {
      const pool = new IPPool();
      const ip = pool.allocate();

      expect(pool.isAllocated(ip)).toBe(true);

      pool.release(ip);

      expect(pool.isAllocated(ip)).toBe(false);
    });
  });

  describe("pool capacity", () => {
    it("should have correct capacity", () => {
      const pool = new IPPool();

      // Range 2-254 = 253 IPs
      expect(pool.getCapacity()).toBe(253);
    });

    it("should track allocated count", () => {
      const pool = new IPPool();

      expect(pool.getAllocatedCount()).toBe(0);

      pool.allocate();
      expect(pool.getAllocatedCount()).toBe(1);

      pool.allocate();
      expect(pool.getAllocatedCount()).toBe(2);
    });
  });
});

describe("generateMacAddress", () => {
  it("should generate deterministic MAC addresses from VM ID", () => {
    const vmId = "test-vm-123";
    const mac1 = generateMacAddress(vmId);
    const mac2 = generateMacAddress(vmId);

    expect(mac1).toBe(mac2);
  });

  it("should generate different MACs for different VM IDs", () => {
    const mac1 = generateMacAddress("vm-1");
    const mac2 = generateMacAddress("vm-2");

    expect(mac1).not.toBe(mac2);
  });

  it("should generate valid MAC address format", () => {
    const mac = generateMacAddress("test-vm");

    // Should match MAC address format XX:XX:XX:XX:XX:XX
    expect(mac).toMatch(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/);
  });

  it("should use locally administered prefix", () => {
    const mac = generateMacAddress("any-vm");

    // First octet should be 02 (locally administered unicast)
    expect(mac.startsWith("02:")).toBe(true);
  });

  it("should generate lowercase MAC addresses", () => {
    const mac = generateMacAddress("TEST-VM-UPPERCASE");

    expect(mac).toBe(mac.toLowerCase());
  });
});
