/**
 * Better Auth Client Configuration
 *
 * Client-side authentication setup using Better Auth.
 */

import { createAuthClient } from "better-auth/react";

// Better Auth requires a full URL with protocol
// In development without VITE_API_URL, use window.location.origin
// In production, VITE_API_URL should be set to the full API URL
const getBaseURL = () => {
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl) return envUrl;
  // Fallback to current origin for relative URL support in development
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return "http://localhost:3000";
};

export const authClient = createAuthClient({
  baseURL: `${getBaseURL()}/api/auth`,
});

export const { useSession, signIn, signOut, signUp } = authClient;

// Export extended user type for use in components
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
