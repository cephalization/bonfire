/**
 * API Key Authentication Client
 *
 * Simple API key-based authentication for the web UI.
 * Replaces Better Auth with a simple X-API-Key header approach.
 */

// API key storage
let apiKey: string | null = null;

/**
 * Get the base URL for the API
 */
const getBaseURL = () => {
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl) return envUrl;
  // Fallback to current origin for relative URL support in development
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return "http://localhost:3000";
};

/**
 * Set the API key for authentication
 */
export function setApiKey(key: string): void {
  apiKey = key;
  localStorage.setItem("bonfire_api_key", key);
}

/**
 * Get the current API key
 */
export function getApiKey(): string | null {
  if (!apiKey) {
    apiKey = localStorage.getItem("bonfire_api_key");
  }
  return apiKey;
}

/**
 * Clear the API key (logout)
 */
export function clearApiKey(): void {
  apiKey = null;
  localStorage.removeItem("bonfire_api_key");
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated(): boolean {
  return !!getApiKey();
}

/**
 * Get auth headers for API requests
 */
export function getAuthHeaders(): Record<string, string> {
  const key = getApiKey();
  if (key) {
    return { "X-API-Key": key };
  }
  return {};
}

/**
 * Simple user type
 */
export interface ApiKeyUser {
  id: string;
  name: string;
  role: "admin" | "user";
}

/**
 * User type for backwards compatibility
 */
export interface UserWithRole {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
  role: "admin" | "member";
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Get current user (returns mock user when authenticated)
 */
export function getCurrentUser(): ApiKeyUser | null {
  if (isAuthenticated()) {
    return {
      id: "api-user",
      name: "API User",
      role: "admin",
    };
  }
  return null;
}

/**
 * Mock auth client for backwards compatibility
 * This provides the same interface as Better Auth but uses API keys
 */
export const authClient = {
  useSession: () => ({
    data: isAuthenticated()
      ? {
          user: {
            id: "api-user",
            name: "API User",
            email: "user@example.com",
            role: "admin",
          },
        }
      : null,
    isPending: false,
  }),
  signIn: {
    email: async ({ email, password }: { email: string; password: string }) => {
      // In a real implementation, this would validate the API key
      // For now, we treat any non-empty password as the API key
      if (password) {
        setApiKey(password);
        return { data: { user: { id: "api-user", email } }, error: null };
      }
      return { data: null, error: { message: "Invalid API key" } };
    },
  },
  signOut: async () => {
    clearApiKey();
    return { data: null, error: null };
  },
  signUp: {
    email: async () => {
      return { data: null, error: { message: "Sign up not available with API key auth" } };
    },
  },
};

// Hook for session management (backwards compatible)
export const useSession = authClient.useSession;

// Sign in object with email method (backwards compatible)
export const signIn = {
  email: authClient.signIn.email,
};

// Sign out function (backwards compatible)
export const signOut = authClient.signOut;

// Sign up object with email method (backwards compatible - not supported)
export const signUp = {
  email: authClient.signUp.email,
};

// Re-export for compatibility
export { getApiKey as getToken, setApiKey as setToken, clearApiKey as clearToken };
