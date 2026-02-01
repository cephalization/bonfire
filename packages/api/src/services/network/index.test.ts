/**
 * Network Service Tests
 * 
 * Unit tests for the combined NetworkService.
 * Uses dependency injection to mock TAP operations.
 */
import { describe, expect, it } from "vitest";
import { NetworkService, IPPool } from './index';
import type { TapDevice } from './tap';

describe('NetworkService', () => {
  const createMockTapFn = (calls: string[]) => {
    return async (vmId: string): Promise<TapDevice> => {
      calls.push(vmId);
      return {
        tapName: `tap-bf-${vmId}`,
        macAddress: '02:00:00:00:00:01',
      };
    };
  };

  const createMockDeleteFn = (calls: string[]) => {
    return async (tapName: string): Promise<void> => {
      calls.push(tapName);
    };
  };

  describe('allocate', () => {
    it('should allocate IP and create TAP device', async () => {
      const ipPool = new IPPool();
      const createTapCalls: string[] = [];
      const mockCreateTap = createMockTapFn(createTapCalls);
      const service = new NetworkService({ ipPool, createTapFn: mockCreateTap });

      const resources = await service.allocate('vm-123');

      expect(resources.ipAddress).toBe('10.0.100.2');
      expect(resources.tapDevice).toBe('tap-bf-vm-123');
      expect(resources.macAddress).toBe('02:00:00:00:00:01');
      expect(createTapCalls).toContain('vm-123');
    });

    it('should release IP if TAP creation fails', async () => {
      const ipPool = new IPPool();
      const mockCreateTap = async (): Promise<TapDevice> => {
        throw new Error('Permission denied');
      };
      const service = new NetworkService({ ipPool, createTapFn: mockCreateTap });

      try {
        await service.allocate('vm-123');
      } catch {
        // Expected to throw
      }

      // IP should have been released
      expect(ipPool.isAllocated('10.0.100.2')).toBe(false);
      expect(ipPool.getAllocatedCount()).toBe(0);
    });

    it('should throw when IP pool is exhausted', async () => {
      const ipPool = new IPPool();
      const mockCreateTap = createMockTapFn([]);
      const service = new NetworkService({ ipPool, createTapFn: mockCreateTap });

      // Exhaust the pool
      const capacity = ipPool.getCapacity();
      for (let i = 0; i < capacity; i++) {
        await service.allocate(`vm-${i}`);
      }

      // Next allocation should throw
      await expect(service.allocate("vm-exhausted")).rejects.toThrow(
        "IP pool exhausted"
      );
    });
  });

  describe('release', () => {
    it('should delete TAP and release IP', async () => {
      const ipPool = new IPPool();
      const createTapCalls: string[] = [];
      const deleteTapCalls: string[] = [];
      const mockCreateTap = createMockTapFn(createTapCalls);
      const mockDeleteTap = createMockDeleteFn(deleteTapCalls);
      const service = new NetworkService({ 
        ipPool, 
        createTapFn: mockCreateTap, 
        deleteTapFn: mockDeleteTap 
      });

      // First allocate
      const resources = await service.allocate('vm-456');

      expect(ipPool.isAllocated(resources.ipAddress)).toBe(true);

      // Then release
      await service.release(resources);

      expect(deleteTapCalls).toContain('tap-bf-vm-456');
      expect(ipPool.isAllocated(resources.ipAddress)).toBe(false);
    });

    it('should handle partial resources gracefully', async () => {
      const ipPool = new IPPool();
      const deleteTapCalls: string[] = [];
      const mockDeleteTap = createMockDeleteFn(deleteTapCalls);
      const service = new NetworkService({ ipPool, deleteTapFn: mockDeleteTap });

      // Release with only tapDevice
      await service.release({ tapDevice: 'tap-bf-vm-789' });
      expect(deleteTapCalls).toContain('tap-bf-vm-789');

      // Release with only ipAddress
      ipPool.allocate(); // Allocate first to have something to release
      await service.release({ ipAddress: '10.0.100.2' });
      expect(ipPool.isAllocated('10.0.100.2')).toBe(false);
    });

    it('should ignore TAP deletion errors during cleanup', async () => {
      const ipPool = new IPPool();
      const createTapCalls: string[] = [];
      const mockCreateTap = createMockTapFn(createTapCalls);
      const mockDeleteTap = async (): Promise<void> => {
        throw new Error('Permission denied');
      };
      const service = new NetworkService({ 
        ipPool, 
        createTapFn: mockCreateTap, 
        deleteTapFn: mockDeleteTap 
      });

      // Allocate first
      const resources = await service.allocate('vm-abc');

      // Release - delete will fail but IP should still be released
      await service.release(resources);

      // IP should be released even if TAP deletion failed
      expect(ipPool.isAllocated(resources.ipAddress)).toBe(false);
    });
  });

  describe('getIPPool', () => {
    it('should return the injected IP pool', () => {
      const ipPool = new IPPool();
      const service = new NetworkService({ ipPool });

      expect(service.getIPPool()).toBe(ipPool);
    });

    it('should create default IP pool if none provided', () => {
      const service = new NetworkService();

      const pool = service.getIPPool();
      expect(pool).toBeInstanceOf(IPPool);
      expect(pool.getCapacity()).toBe(253);
    });
  });
});
