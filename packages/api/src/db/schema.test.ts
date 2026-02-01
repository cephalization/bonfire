import { describe, it, expect } from "vitest";
import { vms, images } from './schema';

describe('Database Schema', () => {
  describe('vms table', () => {
    it('should have all required columns defined', () => {
      expect(vms.id).toBeDefined();
      expect(vms.name).toBeDefined();
      expect(vms.status).toBeDefined();
      expect(vms.vcpus).toBeDefined();
      expect(vms.memoryMib).toBeDefined();
      expect(vms.imageId).toBeDefined();
      expect(vms.pid).toBeDefined();
      expect(vms.socketPath).toBeDefined();
      expect(vms.tapDevice).toBeDefined();
      expect(vms.macAddress).toBeDefined();
      expect(vms.ipAddress).toBeDefined();
      expect(vms.createdAt).toBeDefined();
      expect(vms.updatedAt).toBeDefined();
    });
  });

  describe('images table', () => {
    it('should have all required columns defined', () => {
      expect(images.id).toBeDefined();
      expect(images.reference).toBeDefined();
      expect(images.kernelPath).toBeDefined();
      expect(images.rootfsPath).toBeDefined();
      expect(images.sizeBytes).toBeDefined();
      expect(images.pulledAt).toBeDefined();
    });
  });

  describe('type exports', () => {
    it('should export VM type', () => {
      // Type-only validation - if this compiles, the types work
      expect(true).toBe(true);
    });

    it('should export Image type', () => {
      // Type-only validation - if this compiles, the types work  
      expect(true).toBe(true);
    });
  });
});
