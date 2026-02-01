import { describe, expect, it } from "vitest";
import {
  generateMachineConfig,
  generateBootSource,
  generateDrive,
  generateNetworkInterface,
  DEFAULTS,
} from "./config";

describe("generateMachineConfig", () => {
  it("generates valid machine config with required fields", () => {
    const config = generateMachineConfig({ vcpus: 2, memoryMib: 1024 });

    expect(config).toEqual({
      vcpu_count: 2,
      mem_size_mib: 1024,
    });
  });

  it("accepts minimum values", () => {
    const config = generateMachineConfig({ vcpus: 1, memoryMib: 1 });

    expect(config.vcpu_count).toBe(1);
    expect(config.mem_size_mib).toBe(1);
  });

  it("accepts maximum vcpu count of 32", () => {
    const config = generateMachineConfig({ vcpus: 32, memoryMib: 512 });

    expect(config.vcpu_count).toBe(32);
  });

  it("throws error when vcpus is less than 1", () => {
    expect(() => generateMachineConfig({ vcpus: 0, memoryMib: 512 })).toThrow(
      "vcpu_count must be between 1 and 32"
    );
  });

  it("throws error when vcpus exceeds 32", () => {
    expect(() => generateMachineConfig({ vcpus: 33, memoryMib: 512 })).toThrow(
      "vcpu_count must be between 1 and 32"
    );
  });

  it("throws error when memoryMib is not positive", () => {
    expect(() => generateMachineConfig({ vcpus: 1, memoryMib: 0 })).toThrow(
      "mem_size_mib must be positive"
    );
  });
});

describe("generateBootSource", () => {
  it("generates boot source with kernel path only", () => {
    const config = generateBootSource({
      kernelPath: "/var/lib/bonfire/images/kernel",
    });

    expect(config).toEqual({
      kernel_image_path: "/var/lib/bonfire/images/kernel",
    });
  });

  it("generates boot source with all optional fields", () => {
    const config = generateBootSource({
      kernelPath: "/var/lib/bonfire/images/kernel",
      bootArgs: "console=ttyS0 reboot=k panic=1",
      initrdPath: "/var/lib/bonfire/images/initrd",
    });

    expect(config).toEqual({
      kernel_image_path: "/var/lib/bonfire/images/kernel",
      boot_args: "console=ttyS0 reboot=k panic=1",
      initrd_path: "/var/lib/bonfire/images/initrd",
    });
  });

  it("omits boot_args when not provided", () => {
    const config = generateBootSource({
      kernelPath: "/kernel",
    });

    expect(config).not.toHaveProperty("boot_args");
  });

  it("omits initrd_path when not provided", () => {
    const config = generateBootSource({
      kernelPath: "/kernel",
    });

    expect(config).not.toHaveProperty("initrd_path");
  });

  it("throws error when kernelPath is empty", () => {
    expect(() => generateBootSource({ kernelPath: "" })).toThrow(
      "kernelPath is required"
    );
  });
});

describe("generateDrive", () => {
  it("generates drive config with required fields", () => {
    const config = generateDrive({
      driveId: "rootfs",
      pathOnHost: "/var/lib/bonfire/images/rootfs.ext4",
      isRootDevice: true,
    });

    expect(config).toEqual({
      drive_id: "rootfs",
      path_on_host: "/var/lib/bonfire/images/rootfs.ext4",
      is_root_device: true,
      is_read_only: false, // default
    });
  });

  it("applies default isReadOnly when not specified", () => {
    const config = generateDrive({
      driveId: "rootfs",
      pathOnHost: "/path/to/rootfs",
      isRootDevice: true,
    });

    expect(config.is_read_only).toBe(DEFAULTS.isReadOnly);
  });

  it("respects isReadOnly when set to true", () => {
    const config = generateDrive({
      driveId: "data",
      pathOnHost: "/path/to/data.ext4",
      isRootDevice: false,
      isReadOnly: true,
    });

    expect(config.is_read_only).toBe(true);
  });

  it("generates non-root device config", () => {
    const config = generateDrive({
      driveId: "data",
      pathOnHost: "/path/to/data.ext4",
      isRootDevice: false,
    });

    expect(config.is_root_device).toBe(false);
  });

  it("throws error when driveId is empty", () => {
    expect(() =>
      generateDrive({
        driveId: "",
        pathOnHost: "/path",
        isRootDevice: true,
      })
    ).toThrow("driveId is required");
  });

  it("throws error when pathOnHost is empty", () => {
    expect(() =>
      generateDrive({
        driveId: "rootfs",
        pathOnHost: "",
        isRootDevice: true,
      })
    ).toThrow("pathOnHost is required");
  });
});

describe("generateNetworkInterface", () => {
  it("generates network interface with tap device", () => {
    const config = generateNetworkInterface({
      tapDevice: "tap0",
    });

    expect(config).toEqual({
      iface_id: "eth0", // default
      host_dev_name: "tap0",
    });
  });

  it("applies default ifaceId when not specified", () => {
    const config = generateNetworkInterface({
      tapDevice: "tap0",
    });

    expect(config.iface_id).toBe(DEFAULTS.ifaceId);
  });

  it("respects custom ifaceId", () => {
    const config = generateNetworkInterface({
      ifaceId: "net1",
      tapDevice: "tap1",
    });

    expect(config.iface_id).toBe("net1");
  });

  it("includes guest_mac when provided", () => {
    const config = generateNetworkInterface({
      tapDevice: "tap0",
      macAddress: "AA:FC:00:00:00:01",
    });

    expect(config).toEqual({
      iface_id: "eth0",
      host_dev_name: "tap0",
      guest_mac: "AA:FC:00:00:00:01",
    });
  });

  it("omits guest_mac when not provided", () => {
    const config = generateNetworkInterface({
      tapDevice: "tap0",
    });

    expect(config).not.toHaveProperty("guest_mac");
  });

  it("throws error when tapDevice is empty", () => {
    expect(() => generateNetworkInterface({ tapDevice: "" })).toThrow(
      "tapDevice is required"
    );
  });
});
