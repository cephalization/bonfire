/**
 * Bonfire CLI
 *
 * Command-line interface for managing Firecracker microVMs.
 * Uses Clack for interactive prompts and beautiful output.
 */

import { intro, outro, select, isCancel, cancel } from "@clack/prompts";
import { intro as pintro, outro as poutro, text, confirm, spinner } from "@clack/prompts";
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
  console.log(`
${pc.bold("Bonfire CLI")} v${CLI_VERSION}

${pc.bold("USAGE")}
  bonfire <command> [options]

${pc.bold("COMMANDS")}
  vm          Manage VMs (create, list, start, stop, rm, exec, ssh)
  image       Manage images (pull, list, rm)
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
  bonfire login
`);
}

function showVersion(): void {
  console.log(CLI_VERSION);
}

function normalizeConfigKey(key: string): keyof Config | null {
  if (key === "api-url") return "apiUrl";
  if (key === "token") return "token";
  return null;
}

async function handleConfigCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (subcommand === "set") {
    const rawKey = args[1];
    const value = args[2];

    if (!rawKey || !value) {
      console.error(pc.red("Usage: bonfire config set <key> <value>"));
      console.error(pc.gray("Keys: api-url, token"));
      process.exit(1);
    }

    const key = normalizeConfigKey(rawKey);
    if (!key) {
      console.error(pc.red(`Unknown config key: ${rawKey}`));
      console.error(pc.gray("Valid keys: api-url, token"));
      process.exit(1);
    }

    await setConfigValue(key, value);
    console.log(pc.green(`✓ Set ${rawKey} to ${value}`));
  } else if (subcommand === "get") {
    const rawKey = args[1];

    if (rawKey) {
      const key = normalizeConfigKey(rawKey);
      if (!key) {
        console.error(pc.red(`Unknown config key: ${rawKey}`));
        console.error(pc.gray("Valid keys: api-url, token"));
        process.exit(1);
      }
      const value = await getConfigValue(key);
      console.log(value || "");
    } else {
      const config = await loadConfig();
      console.log(`api-url: ${config.apiUrl}`);
      console.log(`token: ${config.token || "(not set)"}`);
    }
  } else {
    console.error(pc.red("Usage: bonfire config <set|get> [args...]"));
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
        console.error(pc.red(`Unknown command: ${command}`));
        showHelp();
        process.exit(1);
    }
  } catch (error) {
    console.error(pc.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}

main().catch(console.error);
