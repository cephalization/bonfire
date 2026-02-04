/**
 * Login Command
 *
 * Implements the login command for the Bonfire CLI:
 * - Prompts for API URL if not configured
 * - Prompts for API key
 * - Saves API key to config
 * - Prints success message
 */

import { text, spinner, intro, outro, isCancel, cancel, note } from "@clack/prompts";
import pc from "picocolors";
import { loadConfig, saveConfig, type Config } from "../lib/config.js";

/**
 * Prompt for API URL if not configured
 */
async function promptForApiUrl(currentConfig: Config): Promise<string> {
  if (currentConfig.apiUrl && currentConfig.apiUrl !== "http://localhost:3000") {
    return currentConfig.apiUrl;
  }

  const apiUrl = await text({
    message: "Enter the Bonfire API URL:",
    placeholder: "http://localhost:3000",
    initialValue: currentConfig.apiUrl,
    validate: (value) => {
      if (!value) return "API URL is required";
      try {
        new URL(value);
        return undefined;
      } catch {
        return "Please enter a valid URL";
      }
    },
  });

  if (isCancel(apiUrl)) {
    cancel("Login cancelled");
    process.exit(0);
  }

  return apiUrl as string;
}

/**
 * Prompt for API key
 */
async function promptForApiKey(): Promise<string> {
  const apiKey = await text({
    message: "Enter your API key:",
    placeholder: "your-api-key-here",
    validate: (value) => {
      if (!value) return "API key is required";
      return undefined;
    },
  });

  if (isCancel(apiKey)) {
    cancel("Login cancelled");
    process.exit(0);
  }

  return apiKey as string;
}

/**
 * Handle the login command
 */
export async function handleLoginCommand(): Promise<number> {
  intro(pc.bold("Bonfire Login"));

  try {
    // Load current config
    const config = await loadConfig();

    // Prompt for API URL if needed
    const apiUrl = await promptForApiUrl(config);

    // Update API URL in config if changed
    if (apiUrl !== config.apiUrl) {
      config.apiUrl = apiUrl;
      await saveConfig(config);
    }

    // Prompt for API key
    const apiKey = await promptForApiKey();

    // Save API key to config
    const s = spinner();
    s.start("Saving configuration...");

    config.apiKey = apiKey;
    await saveConfig(config);

    s.stop("Configuration saved");

    note(
      `Welcome back!\nAPI URL: ${apiUrl}\n\nAPI key saved to ~/.bonfire/config.json`,
      "Login successful"
    );

    outro("You're all set! Try: bonfire vm list");
    return 0;
  } catch (error) {
    cancel(error instanceof Error ? error.message : String(error));
    outro("Login failed");
    return 1;
  }
}
