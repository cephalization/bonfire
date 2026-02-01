/**
 * VM Commands
 *
 * Implements the vm subcommands for the Bonfire CLI:
 * - create: Create a new VM
 * - list: List all VMs
 * - start: Start a VM
 * - stop: Stop a VM
 * - rm: Remove a VM
 * - exec: Execute a command in a VM
 * - ssh: Open interactive shell in a VM
 */

import { spinner, confirm, isCancel, cancel, outro } from "@clack/prompts";
import pc from "picocolors";
import type { BonfireClient } from "@bonfire/sdk";

// VM types matching the API schema
export interface VM {
  id: string;
  name: string;
  status: "creating" | "running" | "stopped" | "error";
  vcpus: number;
  memoryMib: number;
  imageId?: string;
  ipAddress?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateVMRequest {
  name: string;
  vcpus?: number;
  memoryMib?: number;
  imageId?: string;
}

export interface ExecResponse {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// Argument parsing helpers
export function parseVMCreateArgs(args: string[]): {
  name: string;
  vcpus?: number;
  memory?: number;
  image?: string;
} {
  if (args.length === 0) {
    throw new Error("VM name is required");
  }

  const name = args[0];
  const options: {
    name: string;
    vcpus?: number;
    memory?: number;
    image?: string;
  } = { name };

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];

    if (arg.startsWith("--vcpus=")) {
      const value = parseInt(arg.slice(8), 10);
      if (isNaN(value) || value < 1) {
        throw new Error("Invalid --vcpus value. Must be a positive integer.");
      }
      options.vcpus = value;
    } else if (arg.startsWith("--memory=")) {
      const value = parseInt(arg.slice(9), 10);
      if (isNaN(value) || value < 1) {
        throw new Error("Invalid --memory value. Must be a positive integer.");
      }
      options.memory = value;
    } else if (arg.startsWith("--image=")) {
      options.image = arg.slice(8);
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

export function parseExecArgs(args: string[]): {
  vmIdentifier: string;
  command: string;
  args: string[];
} {
  if (args.length === 0) {
    throw new Error("VM name or ID is required");
  }

  const vmIdentifier = args[0];
  const separatorIndex = args.indexOf("--");

  if (separatorIndex === -1 || separatorIndex === args.length - 1) {
    throw new Error("Command required. Usage: bonfire vm exec <name|id> -- <command> [args...]");
  }

  const commandParts = args.slice(separatorIndex + 1);
  if (commandParts.length === 0) {
    throw new Error("Command required after --");
  }

  return {
    vmIdentifier,
    command: commandParts[0],
    args: commandParts.slice(1),
  };
}

// API client functions
async function apiRequest<T>(
  baseUrl: string,
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const url = new URL(path, baseUrl);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const response = await fetch(url.toString(), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

// VM Command Handlers
export async function handleVMCreate(
  client: BonfireClient,
  baseUrl: string,
  args: string[]
): Promise<void> {
  const options = parseVMCreateArgs(args);

  const request: CreateVMRequest = {
    name: options.name,
    vcpus: options.vcpus,
    memoryMib: options.memory,
    imageId: options.image,
  };

  const s = spinner();
  s.start("Creating VM...");

  try {
    const vm = await apiRequest<VM>(baseUrl, "POST", "/api/vms", request);
    s.stop(pc.green(`✓ VM "${vm.name}" created successfully`));

    console.log();
    console.log(pc.bold("VM Details:"));
    console.log(`  ID:       ${vm.id}`);
    console.log(`  Name:     ${vm.name}`);
    console.log(`  Status:   ${vm.status}`);
    console.log(`  vCPUs:    ${vm.vcpus}`);
    console.log(`  Memory:   ${vm.memoryMib} MiB`);
    if (vm.imageId) console.log(`  Image:    ${vm.imageId}`);
  } catch (error) {
    s.stop(pc.red("Failed to create VM"));
    throw error;
  }
}

export async function handleVMList(client: BonfireClient, baseUrl: string): Promise<void> {
  try {
    const vms = await apiRequest<VM[]>(baseUrl, "GET", "/api/vms");

    if (vms.length === 0) {
      console.log(pc.gray("No VMs found."));
      return;
    }

    // Calculate column widths
    const idWidth = Math.max(4, ...vms.map((v) => v.id.length));
    const nameWidth = Math.max(8, ...vms.map((v) => v.name.length));
    const statusWidth = 8;
    const ipWidth = 12;
    const vcpusWidth = 5;
    const memoryWidth = 6;

    // Print header
    const header = [
      "ID".padEnd(idWidth),
      "Name".padEnd(nameWidth),
      "Status".padEnd(statusWidth),
      "IP".padEnd(ipWidth),
      "vCPUs".padEnd(vcpusWidth),
      "Memory",
    ].join("  ");

    console.log(pc.bold(header));
    console.log(pc.gray("-".repeat(header.length)));

    // Print rows
    for (const vm of vms) {
      const statusColor =
        vm.status === "running"
          ? pc.green
          : vm.status === "stopped"
            ? pc.gray
            : vm.status === "error"
              ? pc.red
              : pc.yellow;

      const row = [
        vm.id.padEnd(idWidth),
        vm.name.padEnd(nameWidth),
        statusColor(vm.status.padEnd(statusWidth)),
        (vm.ipAddress || "-").padEnd(ipWidth),
        String(vm.vcpus).padEnd(vcpusWidth),
        `${vm.memoryMib} MiB`,
      ].join("  ");

      console.log(row);
    }
  } catch (error) {
    throw error;
  }
}

export async function handleVMStart(
  client: BonfireClient,
  baseUrl: string,
  args: string[]
): Promise<void> {
  if (args.length === 0) {
    throw new Error("VM name or ID is required");
  }

  const identifier = args[0];

  const s = spinner();
  s.start(`Starting VM ${identifier}...`);

  try {
    const vm = await apiRequest<VM>(
      baseUrl,
      "POST",
      `/api/vms/${encodeURIComponent(identifier)}/start`
    );
    s.stop(pc.green(`✓ VM "${vm.name}" started successfully`));

    if (vm.ipAddress) {
      console.log(pc.gray(`  IP: ${vm.ipAddress}`));
    }
  } catch (error) {
    s.stop(pc.red("Failed to start VM"));
    throw error;
  }
}

export async function handleVMStop(
  client: BonfireClient,
  baseUrl: string,
  args: string[]
): Promise<void> {
  if (args.length === 0) {
    throw new Error("VM name or ID is required");
  }

  const identifier = args[0];

  const s = spinner();
  s.start(`Stopping VM ${identifier}...`);

  try {
    const vm = await apiRequest<VM>(
      baseUrl,
      "POST",
      `/api/vms/${encodeURIComponent(identifier)}/stop`
    );
    s.stop(pc.green(`✓ VM "${vm.name}" stopped successfully`));
  } catch (error) {
    s.stop(pc.red("Failed to stop VM"));
    throw error;
  }
}

export async function handleVMRemove(
  client: BonfireClient,
  baseUrl: string,
  args: string[]
): Promise<void> {
  if (args.length === 0) {
    throw new Error("VM name or ID is required");
  }

  const identifier = args[0];

  // Get VM details first to show in confirmation
  let vm: VM;
  try {
    vm = await apiRequest<VM>(baseUrl, "GET", `/api/vms/${encodeURIComponent(identifier)}`);
  } catch (error) {
    throw new Error(`VM not found: ${identifier}`);
  }

  const shouldDelete = await confirm({
    message: `Are you sure you want to delete VM "${vm.name}" (${vm.id})?`,
    initialValue: false,
  });

  if (isCancel(shouldDelete) || !shouldDelete) {
    cancel("Deletion cancelled");
    return;
  }

  const s = spinner();
  s.start(`Deleting VM ${identifier}...`);

  try {
    await apiRequest<{ success: true }>(
      baseUrl,
      "DELETE",
      `/api/vms/${encodeURIComponent(identifier)}`
    );
    s.stop(pc.green(`✓ VM "${vm.name}" deleted successfully`));
  } catch (error) {
    s.stop(pc.red("Failed to delete VM"));
    throw error;
  }
}

export async function handleVMExec(
  client: BonfireClient,
  baseUrl: string,
  args: string[]
): Promise<number> {
  const execOptions = parseExecArgs(args);

  const s = spinner();
  s.start(`Executing command in VM ${execOptions.vmIdentifier}...`);

  try {
    const result = await apiRequest<ExecResponse>(
      baseUrl,
      "POST",
      `/api/vms/${encodeURIComponent(execOptions.vmIdentifier)}/exec`,
      {
        command: execOptions.command,
        args: execOptions.args,
      }
    );

    s.stop(pc.green("Command executed"));

    if (result.stdout) {
      process.stdout.write(result.stdout);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }

    return result.exitCode;
  } catch (error) {
    s.stop(pc.red("Failed to execute command"));
    throw error;
  }
}

export async function handleVMSSH(
  client: BonfireClient,
  baseUrl: string,
  args: string[]
): Promise<void> {
  if (args.length === 0) {
    throw new Error("VM name or ID is required");
  }

  const identifier = args[0];

  // Get VM details to check if it's running
  let vm: VM;
  try {
    vm = await apiRequest<VM>(baseUrl, "GET", `/api/vms/${encodeURIComponent(identifier)}`);
  } catch (error) {
    throw new Error(`VM not found: ${identifier}`);
  }

  if (vm.status !== "running") {
    throw new Error(
      `VM is not running (status: ${vm.status}). Start it first with: bonfire vm start ${identifier}`
    );
  }

  if (!vm.ipAddress) {
    throw new Error("VM has no IP address assigned");
  }

  console.log(pc.gray(`Connecting to ${vm.name} (${vm.ipAddress})...`));
  console.log(pc.gray("Press Ctrl+C to exit"));
  console.log();

  // Connect to WebSocket terminal
  const wsUrl = new URL(`/api/vms/${encodeURIComponent(identifier)}/terminal`, baseUrl);
  wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";

  const ws = new WebSocket(wsUrl.toString());

  return new Promise((resolve, reject) => {
    let isReady = false;

    ws.onopen = () => {
      // Terminal connected, wait for ready message
    };

    ws.onmessage = (event) => {
      const data = event.data.toString();

      // Check for ready/error message from server
      if (!isReady) {
        try {
          const msg = JSON.parse(data);
          if (msg.ready) {
            isReady = true;
            // Enable raw mode only after receiving ready message
            process.stdin.setRawMode(true);
            process.stdin.resume();
            process.stdin.setEncoding("utf8");

            // Send a newline to trigger the shell prompt
            ws.send("\n");

            process.stdin.on("data", (inputData: Buffer) => {
              const str = inputData.toString();

              // Handle Ctrl+C to exit
              if (str === "\u0003") {
                ws.close();
                process.stdin.setRawMode(false);
                process.stdin.pause();
                return;
              }

              if (ws.readyState === WebSocket.OPEN) {
                ws.send(inputData);
              }
            });
            return;
          }
          if (msg.error) {
            reject(new Error(msg.error));
            return;
          }
        } catch {
          // Not JSON, treat as terminal output
        }
      }

      // Write terminal output to stdout
      process.stdout.write(data);
    };

    ws.onerror = (error) => {
      reject(new Error("WebSocket connection failed"));
    };

    ws.onclose = () => {
      if (isReady) {
        process.stdin.setRawMode(false);
        process.stdin.pause();
      }
      console.log();
      console.log(pc.gray("Connection closed"));
      resolve();
    };
  });
}

// Main entry point for vm command
export async function handleVMCommand(
  client: BonfireClient,
  baseUrl: string,
  args: string[]
): Promise<number> {
  const subcommand = args[0];

  if (!subcommand) {
    console.error(pc.red("Usage: bonfire vm <create|list|start|stop|rm|exec|ssh> [args...]"));
    return 1;
  }

  const subcommandArgs = args.slice(1);

  try {
    switch (subcommand) {
      case "create":
        await handleVMCreate(client, baseUrl, subcommandArgs);
        return 0;
      case "list":
        await handleVMList(client, baseUrl);
        return 0;
      case "start":
        await handleVMStart(client, baseUrl, subcommandArgs);
        return 0;
      case "stop":
        await handleVMStop(client, baseUrl, subcommandArgs);
        return 0;
      case "rm":
        await handleVMRemove(client, baseUrl, subcommandArgs);
        return 0;
      case "exec": {
        const exitCode = await handleVMExec(client, baseUrl, subcommandArgs);
        return exitCode;
      }
      case "ssh":
        await handleVMSSH(client, baseUrl, subcommandArgs);
        return 0;
      default:
        console.error(pc.red(`Unknown vm subcommand: ${subcommand}`));
        console.error(pc.gray("Valid subcommands: create, list, start, stop, rm, exec, ssh"));
        return 1;
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(pc.red(`Error: ${error.message}`));
    } else {
      console.error(pc.red(`Error: ${String(error)}`));
    }
    return 1;
  }
}
