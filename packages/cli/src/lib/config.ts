/**
 * Config management for the CLI
 *
 * Loads and saves configuration to ~/.bonfire/config.json
 */

import { mkdir, readFile, writeFile } from "fs/promises";
import { join, dirname } from "path";
import { homedir } from "os";

export interface Config {
  apiUrl: string;
  apiKey?: string;
}

export const DEFAULT_CONFIG: Config = {
  apiUrl: "http://localhost:3000",
};

const CONFIG_DIR = join(homedir(), ".bonfire");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

/**
 * Get the config file path
 */
export function getConfigPath(): string {
  return CONFIG_PATH;
}

/**
 * Load config from ~/.bonfire/config.json
 * Returns default config if file doesn't exist
 */
export async function loadConfig(): Promise<Config> {
  try {
    const content = await readFile(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(content);
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ...DEFAULT_CONFIG };
    }
    throw error;
  }
}

/**
 * Save config to ~/.bonfire/config.json
 */
export async function saveConfig(config: Config): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

/**
 * Set a config value
 */
export async function setConfigValue(key: keyof Config, value: string): Promise<void> {
  const config = await loadConfig();
  if (key === "apiUrl") {
    config.apiUrl = value;
  } else if (key === "apiKey") {
    config.apiKey = value;
  }
  await saveConfig(config);
}

/**
 * Get a config value
 */
export async function getConfigValue(key: keyof Config): Promise<string | undefined> {
  const config = await loadConfig();
  return config[key];
}
