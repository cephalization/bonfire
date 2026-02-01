/**
 * Login Command
 *
 * Implements the login command for the Bonfire CLI:
 * - Prompts for API URL if not configured
 * - Prompts for email and password
 * - Calls auth endpoint
 * - Saves token to config
 * - Prints success message
 */

import { text, password, spinner, intro, outro, isCancel, cancel } from "@clack/prompts";
import pc from "picocolors";
import { loadConfig, saveConfig, type Config } from "../lib/config.js";

// Auth response from Better Auth
interface AuthResponse {
  token?: string;
  session?: {
    token: string;
  };
  user?: {
    id: string;
    email: string;
  };
}

// Login credentials
interface LoginCredentials {
  email: string;
  password: string;
}

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
 * Prompt for email and password
 */
async function promptForCredentials(): Promise<LoginCredentials> {
  const email = await text({
    message: "Enter your email:",
    placeholder: "user@example.com",
    validate: (value) => {
      if (!value) return "Email is required";
      if (!value.includes("@")) return "Please enter a valid email";
      return undefined;
    },
  });

  if (isCancel(email)) {
    cancel("Login cancelled");
    process.exit(0);
  }

  const pass = await password({
    message: "Enter your password:",
    mask: "*",
  });

  if (isCancel(pass)) {
    cancel("Login cancelled");
    process.exit(0);
  }

  return {
    email: email as string,
    password: pass as string,
  };
}

/**
 * Call Better Auth sign-in endpoint
 */
async function signIn(apiUrl: string, credentials: LoginCredentials): Promise<AuthResponse> {
  const url = new URL("/api/auth/sign-in/email", apiUrl);

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: credentials.email,
      password: credentials.password,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errorMessage = errorData.message || errorData.error || `HTTP ${response.status}`;
    throw new Error(errorMessage);
  }

  return response.json();
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

    // Prompt for credentials
    const credentials = await promptForCredentials();

    // Attempt login
    const s = spinner();
    s.start("Authenticating...");

    try {
      const authResponse = await signIn(apiUrl, credentials);

      // Extract token from response
      // Better Auth may return token in different formats depending on configuration
      const token = authResponse.token || authResponse.session?.token;

      if (!token) {
        throw new Error("No token received from server");
      }

      // Save token to config
      config.token = token;
      await saveConfig(config);

      s.stop(pc.green("✓ Authentication successful"));

      console.log();
      console.log(pc.bold("Welcome back!"));
      if (authResponse.user?.email) {
        console.log(pc.gray(`Logged in as: ${authResponse.user.email}`));
      }
      console.log();
      console.log(pc.gray(`Token saved to ~/.bonfire/config.json`));

      outro(pc.green("You're all set! Try: bonfire vm list"));
      return 0;
    } catch (error) {
      s.stop(pc.red("Authentication failed"));
      throw error;
    }
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("Invalid email or password")) {
        console.error(pc.red("Error: Invalid email or password"));
      } else {
        console.error(pc.red(`Error: ${error.message}`));
      }
    } else {
      console.error(pc.red(`Error: ${String(error)}`));
    }
    outro(pc.red("Login failed"));
    return 1;
  }
}
