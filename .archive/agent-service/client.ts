/**
 * Agent HTTP Client
 *
 * HTTP client for communicating with the guest agent running inside VMs.
 * The agent listens on port 8080 and provides health checks, command execution,
 * and file transfer capabilities.
 *
 * Based on Slicer agent API: https://docs.slicervm.com/reference/api
 */

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface AgentClientOptions {
  ipAddress: string;
  port?: number;
  timeoutMs?: number;
}

export class AgentError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = "AgentError";
  }
}

export class AgentTimeoutError extends AgentError {
  constructor(message: string) {
    super(message);
    this.name = "AgentTimeoutError";
  }
}

export class AgentConnectionError extends AgentError {
  constructor(message: string, cause?: Error) {
    super(message, cause);
    this.name = "AgentConnectionError";
  }
}

/**
 * HTTP client for communicating with the guest agent inside a VM.
 * The agent runs on port 8080 by default.
 */
export class AgentClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: AgentClientOptions) {
    const port = options.port ?? 8080;
    this.baseUrl = `http://${options.ipAddress}:${port}`;
    this.timeoutMs = options.timeoutMs ?? 30000;
  }

  /**
   * Build a URL with the base URL and path
   */
  private buildUrl(
    path: string,
    queryParams?: Record<string, string | number | boolean | undefined>
  ): string {
    const url = new URL(path, this.baseUrl);

    if (queryParams) {
      for (const [key, value] of Object.entries(queryParams)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    return url.toString();
  }

  /**
   * Execute an HTTP request with timeout handling
   */
  private async fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === "AbortError") {
          throw new AgentTimeoutError(`Request timed out after ${this.timeoutMs}ms`);
        }
        throw new AgentConnectionError(`Failed to connect to agent: ${error.message}`, error);
      }
      throw new AgentConnectionError("Failed to connect to agent");
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Check if the agent is healthy and responsive.
   * Returns true if the agent responds with 200 OK.
   */
  async checkHealth(): Promise<boolean> {
    try {
      const url = this.buildUrl("/health");
      const response = await this.fetchWithTimeout(url, {
        method: "GET",
      });
      return response.status === 200;
    } catch (error) {
      if (error instanceof AgentTimeoutError || error instanceof AgentConnectionError) {
        return false;
      }
      return false;
    }
  }

  /**
   * Execute a command in the VM.
   * @param command - The command to execute
   * @param args - Command arguments
   * @returns Object containing stdout, stderr, and exit code
   */
  async exec(command: string, args: string[] = []): Promise<ExecResult> {
    // Build URL with cmd parameter and args
    const url = this.buildUrl("/exec", { cmd: command });
    const urlObj = new URL(url);
    for (const arg of args) {
      urlObj.searchParams.append("args", arg);
    }

    const response = await this.fetchWithTimeout(urlObj.toString(), {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new AgentError(`Exec failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    // Parse the newline-delimited JSON response
    const text = await response.text();
    const lines = text.trim().split("\n");

    let stdout = "";
    let stderr = "";
    let exitCode = 0;
    let error: string | undefined;

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const data = JSON.parse(line);
        if (data.stdout) stdout += data.stdout;
        if (data.stderr) stderr += data.stderr;
        if (data.exit_code !== undefined) exitCode = data.exit_code;
        if (data.error) error = data.error;
      } catch {
        // Ignore malformed JSON lines
      }
    }

    if (error) {
      throw new AgentError(`Command execution failed: ${error}`);
    }

    return { stdout, stderr, exitCode };
  }

  /**
   * Upload a file to the VM.
   * @param localPath - Path to the local file
   * @param remotePath - Destination path in the VM
   */
  async upload(localPath: string, remotePath: string): Promise<void> {
    // Read the file content
    const file = Bun.file(localPath);

    if (!(await file.exists())) {
      throw new AgentError(`Local file not found: ${localPath}`);
    }

    const content = await file.arrayBuffer();

    const url = this.buildUrl("/cp", {
      path: remotePath,
      mode: "binary",
    });

    const response = await this.fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
      },
      body: content,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new AgentError(
        `Upload failed: ${response.status} ${response.statusText} - ${errorText}`
      );
    }
  }

  /**
   * Download a file from the VM.
   * @param remotePath - Path to the file in the VM
   * @returns Buffer containing the file content
   */
  async download(remotePath: string): Promise<Buffer> {
    const url = this.buildUrl("/cp", {
      path: remotePath,
      mode: "binary",
    });

    const response = await this.fetchWithTimeout(url, {
      method: "GET",
      headers: {
        Accept: "application/octet-stream",
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new AgentError(`File not found: ${remotePath}`);
      }
      const errorText = await response.text().catch(() => "Unknown error");
      throw new AgentError(
        `Download failed: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}

/**
 * Factory function to create an AgentClient for a VM
 */
export function createAgentClient(
  ipAddress: string,
  options?: Omit<AgentClientOptions, "ipAddress">
): AgentClient {
  return new AgentClient({
    ipAddress,
    ...options,
  });
}
