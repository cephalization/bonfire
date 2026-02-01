import { describe, expect, it } from "vitest";
import {
  putMachineConfig,
  putBootSource,
  putDrive,
  putNetworkInterface,
  startInstance,
  sendCtrlAltDel,
  configureVM,
  isApiReady,
  type VMConfiguration,
  type FirecrackerInstanceInfo,
} from "./socket-client";

describe("socket-client types and exports", () => {
  it("exports VMConfiguration type", () => {
    // Type-only test - ensures types are exported correctly
    const config: VMConfiguration = {
      machineConfig: { vcpu_count: 2, mem_size_mib: 512 },
      bootSource: { kernel_image_path: "/path/to/kernel" },
      drives: [
        {
          drive_id: "rootfs",
          path_on_host: "/path/to/rootfs",
          is_root_device: true,
          is_read_only: false,
        },
      ],
      networkInterfaces: [
        {
          iface_id: "eth0",
          host_dev_name: "tap0",
        },
      ],
    };

    expect(config.machineConfig.vcpu_count).toBe(2);
    expect(config.machineConfig.mem_size_mib).toBe(512);
    expect(config.bootSource.kernel_image_path).toBe("/path/to/kernel");
    expect(config.drives.length).toBe(1);
    expect(config.networkInterfaces.length).toBe(1);
  });

  it("has correct FirecrackerInstanceInfo type structure", () => {
    const info: FirecrackerInstanceInfo = {
      app_name: "Firecracker",
      id: "test-vm",
      state: "Running",
      vmm_version: "1.14.0",
    };

    expect(info.app_name).toBe("Firecracker");
    expect(info.id).toBe("test-vm");
    expect(info.state).toBe("Running");
    expect(info.vmm_version).toBe("1.14.0");
  });

  it("validates action types", () => {
    const startAction = { action_type: "InstanceStart" } as const;
    const shutdownAction = { action_type: "SendCtrlAltDel" } as const;
    const metricsAction = { action_type: "FlushMetrics" } as const;

    expect(startAction.action_type).toBe("InstanceStart");
    expect(shutdownAction.action_type).toBe("SendCtrlAltDel");
    expect(metricsAction.action_type).toBe("FlushMetrics");
  });

  it("exports all required functions", () => {
    expect(typeof putMachineConfig).toBe("function");
    expect(typeof putBootSource).toBe("function");
    expect(typeof putDrive).toBe("function");
    expect(typeof putNetworkInterface).toBe("function");
    expect(typeof startInstance).toBe("function");
    expect(typeof sendCtrlAltDel).toBe("function");
    expect(typeof configureVM).toBe("function");
    expect(typeof isApiReady).toBe("function");
  });
});

describe("socket-client error handling", () => {
  it("isApiReady returns false when socket does not exist", async () => {
    // Test with non-existent socket path
    const result = await isApiReady("/nonexistent/path/to/socket.sock");
    expect(result).toBe(false);
  });
});
