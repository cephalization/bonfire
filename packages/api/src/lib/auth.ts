/**
 * Simple API Key Authentication
 *
 * Replaces Better Auth with a simple API key system.
 * All requests must include X-API-Key header.
 */

import { config } from "./config";

/**
 * Simple user type for API key authentication
 */
export interface ApiKeyUser {
  id: string;
  name: string;
  role: "admin" | "user";
}

/**
 * Validate an API key
 * @returns The user if valid, null if invalid
 */
export function validateApiKey(apiKey: string): ApiKeyUser | null {
  if (apiKey === config.apiKey) {
    return {
      id: "api-user",
      name: "API User",
      role: "admin",
    };
  }
  return null;
}

/**
 * Get the configured API key (for CLI setup)
 */
export function getApiKey(): string {
  return config.apiKey;
}
