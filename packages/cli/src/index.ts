/**
 * Bonfire CLI
 *
 * Command-line interface for managing Firecracker microVMs.
 * Uses Clack for interactive prompts and beautiful output.
 */

import {
  intro,
  outro,
  select,
  isCancel,
  cancel,
  text,
  confirm,
  spinner,
  note,
} from "@clack/prompts";
import pc from "picocolors";
import {
  loadConfig,
  saveConfig,
  setConfigValue,
  getConfigValue,
  type Config,
} from "./lib/config.js";
import { createClient } from "./lib/client.js";
import { handleVMCommand } from "./commands/vm.js";
import { handleImageCommand } from "./commands/image.js";
import { handleLoginCommand } from "./commands/login.js";

export const CLI_VERSION = "0.0.1";

function showHelp(): void {
  note(
    `${pc.bold("USAGE")}
  bonfire <command> [options]

${pc.bold("COMMANDS")}
  vm          Manage VMs (create, list, start, stop, rm, ssh)
  image       Manage images (list, rm)
  config      Manage configuration (set, get)
  login       Authenticate with Bonfire server

${pc.bold("GLOBAL OPTIONS")}
  --api-url   Override the API URL
  --config    Path to custom config file
  --help, -h  Show this help message
  --version   Show version number

${pc.bold("EXAMPLES")}
  bonfire config set api-url http://localhost:3000
  bonfire vm list
  bonfire vm ssh my-vm
  bonfire login`,
    `${pc.bold("Bonfire CLI")} v${CLI_VERSION}`
  );
}

function showVersion(): void {
  note(CLI_VERSION, `Bonfire CLI v${CLI_VERSION}`);
}

function normalizeConfigKey(key: string): keyof Config | null {
  if (key === "api-url") return "apiUrl";
  if (key === "api-key") return "apiKey";
  return null;
}

async function handleConfigCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (subcommand === "set") {
    const rawKey = args[1];
    const value = args[2];

    if (!rawKey || !value) {
      cancel("Usage: bonfire config set <key> <value>\nKeys: api-url, api-key");
      process.exit(1);
    }

    const key = normalizeConfigKey(rawKey);
    if (!key) {
      cancel(`Unknown config key: ${rawKey}\nValid keys: api-url, api-key`);
      process.exit(1);
    }

    await setConfigValue(key, value);
    note(`${rawKey} = ${value}`, "Configuration saved");
  } else if (subcommand === "get") {
    const rawKey = args[1];

    if (rawKey) {
      const key = normalizeConfigKey(rawKey);
      if (!key) {
        cancel(`Unknown config key: ${rawKey}\nValid keys: api-url, api-key`);
        process.exit(1);
      }
      const value = await getConfigValue(key);
      note(value || "(not set)", rawKey);
    } else {
      const config = await loadConfig();
      note(
        `api-url: ${config.apiUrl}\napi-key: ${config.apiKey || "(not set)"}`,
        "Current Configuration"
      );
    }
  } else {
    cancel("Usage: bonfire config <set|get> [args...]");
    process.exit(1);
  }
}

async function handleVmCommand(args: string[]): Promise<void> {
  const client = await createClient();
  const config = await loadConfig();
  const exitCode = await handleVMCommand(client, config.apiUrl, args);
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

async function handleImageCmd(args: string[]): Promise<void> {
  const client = await createClient();
  const config = await loadConfig();
  const exitCode = await handleImageCommand(client, config.apiUrl, args);
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

async function handleLoginCmd(): Promise<void> {
  const exitCode = await handleLoginCommand();
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Parse global flags
  const hasHelp = args.includes("--help") || args.includes("-h");
  const hasVersion = args.includes("--version");

  // Remove flags from args
  const filteredArgs = args.filter((arg) => !arg.startsWith("--"));
  const command = filteredArgs[0];
  const commandArgs = filteredArgs.slice(1);

  if (hasVersion) {
    showVersion();
    return;
  }

  if (hasHelp || !command) {
    showHelp();
    return;
  }

  try {
    switch (command) {
      case "config":
        await handleConfigCommand(commandArgs);
        break;
      case "vm":
        await handleVmCommand(commandArgs);
        break;
      case "image":
        await handleImageCmd(commandArgs);
        break;
      case "login":
        await handleLoginCmd();
        break;
      default:
        cancel(`Unknown command: ${command}`);
        showHelp();
        process.exit(1);
    }
  } catch (error) {
    cancel(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main().catch(console.error);
