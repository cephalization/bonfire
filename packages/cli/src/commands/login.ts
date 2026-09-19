/**
 * Login Command
 *
 * Implements the login command for the Bonfire CLI:
 * - Prompts for API URL if not configured
 * - Prompts for an API key (created in the web UI under Settings → API keys)
 * - Checks the key against the server
 * - Saves it to config
 */

import { text, spinner, intro, outro, isCancel, cancel, note, log } from "@clack/prompts";
import pc from "picocolors";
import { loadConfig, saveConfig, type Config } from "../lib/config.js";
import { createClientWithConfig } from "../lib/client.js";

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
    message: "Enter your API key (web UI → Settings → API keys):",
    placeholder: "bonfire_...",
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

    // Check it against the server before saving. Listing VMs exercises both
    // the key and the organization it was created for.
    const s = spinner();
    s.start("Checking the key...");
    try {
      await createClientWithConfig({ baseUrl: apiUrl, apiKey }).listVMs();
      s.stop("Key accepted");
    } catch (error) {
      s.stop("Could not verify the key");
      log.warn(
        `${error instanceof Error ? error.message : String(error)}\n` +
          "Saving it anyway; check the API URL and that the key was created for an organization."
      );
    }

    config.apiKey = apiKey;
    await saveConfig(config);

    note(`API URL: ${apiUrl}\n\nAPI key saved to ~/.bonfire/config.json`, "Login successful");

    outro("You're all set! Try: bonfire vm list");
    return 0;
  } catch (error) {
    cancel(error instanceof Error ? error.message : String(error));
    outro("Login failed");
    return 1;
  }
}
