/**
 * SSH Key Injection Service Tests
 *
 * Unit tests for SSH key generation and injection logic.
 * These tests mock filesystem and command operations.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock child_process
vi.mock("child_process", () => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}));

// Mock fs/promises
const mockMkdir = vi.fn();
const mockWriteFile = vi.fn();
const mockReadFile = vi.fn();
const mockChmod = vi.fn();
const mockStat = vi.fn();
const mockMkdtemp = vi.fn();
const mockRm = vi.fn();

vi.mock("fs/promises", () => ({
  mkdir: (...args: any[]) => mockMkdir(...args),
  writeFile: (...args: any[]) => mockWriteFile(...args),
  readFile: (...args: any[]) => mockReadFile(...args),
  chmod: (...args: any[]) => mockChmod(...args),
  stat: (...args: any[]) => mockStat(...args),
  mkdtemp: (...args: any[]) => mockMkdtemp(...args),
  rm: (...args: any[]) => mockRm(...args),
}));

// Import after mocking
import { execFile } from "child_process";
import {
  generateSSHKeyPair,
  saveSSHKeys,
  loadSSHPublicKey,
  hasSSHKeys,
  injectSSHKeys,
  deleteSSHKeys,
  createSSHKeyService,
  type SSHKeyPair,
} from "./ssh-keys";

describe("SSH Key Service", () => {
  const testKeysDir = "/tmp/test-keys";

  beforeEach(() => {
    vi.resetAllMocks();
    // Reset process.env for each test
    delete process.env.VITEST;
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("generateSSHKeyPair", () => {
    it("should generate a new SSH key pair", async () => {
      // Setup mocks
      const mockTempDir = "/tmp/bonfire-ssh-abc123";
      mockMkdtemp.mockResolvedValue(mockTempDir);

      // Mock execFile to simulate successful ssh-keygen
      const execFileMock = vi.mocked(execFile);
      execFileMock.mockImplementation((_cmd: string, _args: any, callback: any) => {
        if (callback) callback(null, { stdout: "" }, "");
        return undefined as any;
      });

      mockReadFile
        .mockResolvedValueOnce("PRIVATE_KEY_CONTENT")
        .mockResolvedValueOnce("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA test@bonfire");

      const result = await generateSSHKeyPair();

      expect(result).toEqual({
        privateKey: "PRIVATE_KEY_CONTENT",
        publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA test@bonfire",
        fingerprint: expect.any(String),
      });

      // Verify ssh-keygen was called with correct arguments
      expect(execFileMock).toHaveBeenCalledWith(
        "ssh-keygen",
        expect.arrayContaining(["-t", "ed25519"]),
        expect.any(Function)
      );
    });

    it("should cleanup temp directory after key generation", async () => {
      const mockTempDir = "/tmp/bonfire-ssh-abc123";
      mockMkdtemp.mockResolvedValue(mockTempDir);

      const execFileMock = vi.mocked(execFile);
      execFileMock.mockImplementation((_cmd: string, _args: any, callback: any) => {
        if (callback) callback(null, { stdout: "" }, "");
        return undefined as any;
      });

      mockReadFile
        .mockResolvedValueOnce("PRIVATE_KEY_CONTENT")
        .mockResolvedValueOnce("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA test@bonfire");

      await generateSSHKeyPair();

      expect(mockRm).toHaveBeenCalledWith(mockTempDir, { recursive: true, force: true });
    });
  });

  describe("saveSSHKeys", () => {
    it("should save key pair to disk with correct permissions", async () => {
      const keyPair: SSHKeyPair = {
        privateKey: "private-key-content",
        publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA test@bonfire",
        fingerprint: "SHA256:abc123",
      };

      mockMkdir.mockResolvedValue(undefined);
      mockChmod.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);

      const result = await saveSSHKeys("vm-123", keyPair, testKeysDir);

      expect(result).toEqual({
        privateKeyPath: `${testKeysDir}/vm-vm-123`,
        publicKeyPath: `${testKeysDir}/vm-vm-123.pub`,
      });

      // Verify private key is written with 600 permissions
      expect(mockWriteFile).toHaveBeenCalledWith(
        `${testKeysDir}/vm-vm-123`,
        "private-key-content",
        { mode: 0o600 }
      );

      // Verify public key is written with 644 permissions
      expect(mockWriteFile).toHaveBeenCalledWith(
        `${testKeysDir}/vm-vm-123.pub`,
        "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA test@bonfire",
        { mode: 0o644 }
      );
    });
  });

  describe("loadSSHPublicKey", () => {
    it("should load existing public key", async () => {
      const publicKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA test@bonfire";
      mockReadFile.mockResolvedValue(publicKey);

      const result = await loadSSHPublicKey("vm-123", testKeysDir);

      expect(result).toBe(publicKey);
      expect(mockReadFile).toHaveBeenCalledWith(`${testKeysDir}/vm-vm-123.pub`, "utf-8");
    });

    it("should return null if key does not exist", async () => {
      mockReadFile.mockRejectedValue(new Error("ENOENT"));

      const result = await loadSSHPublicKey("vm-123", testKeysDir);

      expect(result).toBeNull();
    });
  });

  describe("hasSSHKeys", () => {
    it("should return true if both keys exist", async () => {
      mockStat.mockResolvedValue({});

      const result = await hasSSHKeys("vm-123", testKeysDir);

      expect(result).toBe(true);
      expect(mockStat).toHaveBeenCalledTimes(2);
    });

    it("should return false if keys do not exist", async () => {
      mockStat.mockRejectedValue(new Error("ENOENT"));

      const result = await hasSSHKeys("vm-123", testKeysDir);

      expect(result).toBe(false);
    });
  });

  describe("deleteSSHKeys", () => {
    it("should delete both key files", async () => {
      mockRm.mockResolvedValue(undefined);

      await deleteSSHKeys("vm-123", testKeysDir);

      expect(mockRm).toHaveBeenCalledWith(`${testKeysDir}/vm-vm-123`, { force: true });
      expect(mockRm).toHaveBeenCalledWith(`${testKeysDir}/vm-vm-123.pub`, { force: true });
    });

    it("should not throw if keys do not exist", async () => {
      mockRm.mockRejectedValue(new Error("ENOENT"));

      await expect(deleteSSHKeys("vm-123", testKeysDir)).resolves.not.toThrow();
    });
  });

  describe("injectSSHKeys", () => {
    it("should return mock paths in test mode", async () => {
      process.env.VITEST = "true";

      const result = await injectSSHKeys({
        rootfsPath: "/path/to/rootfs.ext4",
        vmId: "vm-123",
        keysDir: testKeysDir,
      });

      expect(result).toEqual({
        publicKey: "ssh-ed25519 TEST_KEY test@bonfire",
        privateKeyPath: `${testKeysDir}/vm-vm-123`,
        authorizedKeysPath: "/home/agent/.ssh/authorized_keys",
      });

      // Should not attempt to mount in test mode
      const execFileMock = vi.mocked(execFile);
      expect(execFileMock).not.toHaveBeenCalled();
    });

    it("should return mock paths when NODE_ENV is test", async () => {
      process.env.NODE_ENV = "test";

      const result = await injectSSHKeys({
        rootfsPath: "/path/to/rootfs.ext4",
        vmId: "vm-123",
        keysDir: testKeysDir,
      });

      expect(result.publicKey).toBe("ssh-ed25519 TEST_KEY test@bonfire");
    });
  });

  describe("createSSHKeyService", () => {
    it("should create a service with all methods", () => {
      const service = createSSHKeyService(testKeysDir);

      expect(service).toHaveProperty("generateKeyPair");
      expect(service).toHaveProperty("injectKeys");
      expect(service).toHaveProperty("hasKeys");
      expect(service).toHaveProperty("loadPublicKey");
      expect(service).toHaveProperty("deleteKeys");
      expect(service).toHaveProperty("getPrivateKeyPath");
    });

    it("should use provided keys directory", async () => {
      const service = createSSHKeyService("/custom/keys/dir");

      mockStat.mockResolvedValue({});

      const result = await service.hasKeys("vm-123");

      expect(result).toBe(true);
      expect(mockStat).toHaveBeenCalledWith("/custom/keys/dir/vm-vm-123");
    });

    it("should return correct private key path", () => {
      const service = createSSHKeyService(testKeysDir);

      const path = service.getPrivateKeyPath("vm-123");

      expect(path).toBe(`${testKeysDir}/vm-vm-123`);
    });
  });
});
