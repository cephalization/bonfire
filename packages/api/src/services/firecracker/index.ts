/**
 * Firecracker Service Module
 *
 * This module provides functionality for managing Firecracker microVMs.
 */

// Config generation (pure functions)
export {
  generateMachineConfig,
  generateBootSource,
  generateDrive,
  generateNetworkInterface,
  DEFAULTS,
  type MachineConfigInput,
  type BootSourceInput,
  type DriveInput,
  type NetworkInterfaceInput,
  type FirecrackerMachineConfig,
  type FirecrackerBootSource,
  type FirecrackerDrive,
  type FirecrackerNetworkInterface,
} from "./config";

// Process management
export {
  spawnFirecracker,
  configureVMProcess,
  startVMProcess,
  stopVMProcess,
  type FirecrackerProcess,
  type SpawnOptions,
  type StopOptions,
} from "./process";

// Socket client
export {
  putMachineConfig,
  putBootSource,
  putDrive,
  putNetworkInterface,
  startInstance,
  sendCtrlAltDel,
  getInstanceInfo,
  configureVM,
  isApiReady,
  waitForApiReady,
  type FirecrackerInstanceAction,
  type FirecrackerError,
  type FirecrackerInstanceInfo,
  type VMConfiguration,
} from "./socket-client";

// Serial console
export {
  create as createSerialConsole,
  createPipes,
  cleanupPipes,
  generatePipePaths,
  formatResizeMessage,
  SerialConsoleError,
  type SerialConsole,
  type SerialConsolePaths,
  type SerialConsoleOptions,
} from "./serial";

// Serial runner (deterministic command execution over ttyS0)
export {
  createSerialRunner,
  SerialRunner,
  SerialRunnerError,
  type SerialRunnerCommandResult,
  type SerialRunnerRunOptions,
  type CreateSerialRunnerOptions,
  type SerialRunnerLike,
} from "./serial-runner";
