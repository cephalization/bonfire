/**
 * Client wrapper for the Bonfire SDK
 *
 * Configures the SDK with authentication from config
 */

import { BonfireClient, type ClientConfig } from "@bonfire/sdk";
import { loadConfig } from "./config.js";

/**
 * Create a configured Bonfire SDK client
 * Loads config from ~/.bonfire/config.json
 */
export async function createClient(): Promise<BonfireClient> {
  const config = await loadConfig();

  const clientConfig: ClientConfig = {
    baseUrl: config.apiUrl,
  };

  if (config.token) {
    clientConfig.token = config.token;
  }

  return new BonfireClient(clientConfig);
}

/**
 * Create a Bonfire SDK client with explicit config
 */
export function createClientWithConfig(config: ClientConfig): BonfireClient {
  return new BonfireClient(config);
}

export { BonfireClient };
