import { randomUUID } from "crypto";
import type { SerialConsole, SerialConsoleOptions } from "./serial";
import { create as createSerialConsole } from "./serial";

export type SerialRunnerCommandResult = {
  exitCode: number;
  output: string;
};

export interface SerialRunnerLike {
  connect(): Promise<void>;
  run(command: string, options?: SerialRunnerRunOptions): Promise<SerialRunnerCommandResult>;
  close(): Promise<void>;
}

export type SerialRunnerRunOptions = {
  timeoutMs?: number;
  maxOutputBytes?: number;
};

export type CreateSerialRunnerOptions = {
  vmId: string;
  pipeDir?: string;

  /** If provided, uses this console instead of creating one. */
  serialConsole?: SerialConsole;
  /** For tests/DI. Ignored when serialConsole is provided. */
  createConsoleFn?: (options: SerialConsoleOptions) => Promise<SerialConsole>;

  connectTimeoutMs?: number;
  defaultCommandTimeoutMs?: number;
  defaultMaxOutputBytes?: number;
};

export class SerialRunnerError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "CONNECT_TIMEOUT"
      | "LOGIN_PROMPT"
      | "COMMAND_TIMEOUT"
      | "OUTPUT_LIMIT"
      | "CONCURRENT_WAIT"
      | "CLOSED"
  ) {
    super(message);
    this.name = "SerialRunnerError";
  }
}

export class SerialRunner implements SerialRunnerLike {
  private console: SerialConsole;
  private decoder = new TextDecoder();
  private active = true;

  private buffer = "";
  private bufferBytes = 0;
  private notifyWaiters: Array<() => void> = [];
  private waiting = false;

  private connectTimeoutMs: number;
  private defaultCommandTimeoutMs: number;
  private defaultMaxOutputBytes: number;
  private promptToken: string;

  constructor(
    console: SerialConsole,
    opts: Required<
      Pick<
        CreateSerialRunnerOptions,
        "connectTimeoutMs" | "defaultCommandTimeoutMs" | "defaultMaxOutputBytes"
      >
    >
  ) {
    this.console = console;
    this.connectTimeoutMs = opts.connectTimeoutMs;
    this.defaultCommandTimeoutMs = opts.defaultCommandTimeoutMs;
    this.defaultMaxOutputBytes = opts.defaultMaxOutputBytes;
    this.promptToken = `__BF_PROMPT__${randomUUID()}`;

    this.console.onData((data) => {
      if (!this.active) return;
      const text = this.decoder.decode(data);
      this.buffer += text;
      this.bufferBytes += data.byteLength;
      const waiters = this.notifyWaiters;
      this.notifyWaiters = [];
      for (const w of waiters) w();
    });
  }

  getSerialConsole(): SerialConsole {
    return this.console;
  }

  async close(): Promise<void> {
    if (!this.active) return;
    this.active = false;
    await this.console.close();
    const waiters = this.notifyWaiters;
    this.notifyWaiters = [];
    for (const w of waiters) w();
  }

  /**
   * Ensure we have a usable shell on ttyS0.
   * - Fail fast if we see `login:` (autologin not enabled)
   * - Otherwise set a deterministic PS1 prompt token
   */
  async connect(): Promise<void> {
    this.ensureActive();

    // Nudge output.
    await this.console.write("\n");

    // Quick check: if the VM is already at a prompt, set PS1 to a known token.
    await this.console.write(`export PS1=\"${this.promptToken}> \"\n`);
    await this.console.write("\n");

    await this.readUntil(
      (text) => {
        if (includesLoginPrompt(text)) {
          throw new SerialRunnerError(
            "Serial console is showing a login prompt. Enable ttyS0 autologin for user 'agent' in the agent image.",
            "LOGIN_PROMPT"
          );
        }
        return text.includes(`${this.promptToken}> `) || looksLikeShellPrompt(text);
      },
      {
        timeoutMs: this.connectTimeoutMs,
        maxOutputBytes: this.defaultMaxOutputBytes,
        timeoutCode: "CONNECT_TIMEOUT",
      }
    );
  }

  async run(
    command: string,
    options: SerialRunnerRunOptions = {}
  ): Promise<SerialRunnerCommandResult> {
    this.ensureActive();
    if (this.waiting) {
      throw new SerialRunnerError("Concurrent serial waits are not supported", "CONCURRENT_WAIT");
    }

    const nonce = randomUUID();
    const begin = `__BF_BEGIN__${nonce}`;
    const endPrefix = `__BF_END__${nonce}:`;
    const endRegex = new RegExp(`${escapeRegExp(endPrefix)}(\\d+)`, "g");

    const startIndex = this.buffer.length;
    const payload = `echo ${begin}\n${command}; echo ${endPrefix}$?\n`;
    await this.console.write(payload);

    const timeoutMs = options.timeoutMs ?? this.defaultCommandTimeoutMs;
    const maxOutputBytes = options.maxOutputBytes ?? this.defaultMaxOutputBytes;

    await this.readUntil(
      (text) => {
        if (includesLoginPrompt(text)) {
          throw new SerialRunnerError(
            "Serial console is showing a login prompt. Enable ttyS0 autologin for user 'agent' in the agent image.",
            "LOGIN_PROMPT"
          );
        }
        // Important: the terminal will echo the input line, which includes
        // `echo __BF_END__<nonce>:$?`. That contains the prefix but NOT a digit.
        // Only treat it as completed when we see the marker followed by digits.
        const slice = text.slice(startIndex);
        endRegex.lastIndex = 0;
        return endRegex.test(slice);
      },
      {
        timeoutMs,
        maxOutputBytes,
        timeoutCode: "COMMAND_TIMEOUT",
      }
    );

    const slice = this.buffer.slice(startIndex);
    endRegex.lastIndex = 0;
    const match = endRegex.exec(slice);
    if (!match || match.index === undefined) {
      throw new SerialRunnerError("Failed to parse command completion marker", "COMMAND_TIMEOUT");
    }

    const endIdx = startIndex + match.index;
    const code = Number.parseInt(match[1], 10);
    const exitCode = Number.isFinite(code) ? code : 1;
    const segment = this.buffer.slice(startIndex, endIdx);
    let cleaned = stripMarkers(segment, begin);
    cleaned = cleaned.replace(new RegExp(`__BF_END__${escapeRegExp(nonce)}:\\$\\?`, "g"), "");
    cleaned = cleaned.replace(/__BF_PROMPT__[0-9a-f-]+>\s*/g, "");

    return {
      exitCode,
      output: cleaned,
    };
  }

  private ensureActive(): void {
    if (!this.active) {
      throw new SerialRunnerError("Serial runner is closed", "CLOSED");
    }
  }

  private async readUntil(
    predicate: (text: string) => boolean,
    opts: {
      timeoutMs: number;
      maxOutputBytes: number;
      timeoutCode: "CONNECT_TIMEOUT" | "COMMAND_TIMEOUT";
    }
  ): Promise<void> {
    this.waiting = true;

    const start = Date.now();
    try {
      // Loop until predicate passes, or timeout.
      // Predicate may throw to raise actionable errors.
      // NOTE: maxOutputBytes is enforced against total buffer size.
      while (true) {
        this.ensureActive();

        if (this.bufferBytes > opts.maxOutputBytes) {
          throw new SerialRunnerError(
            `Serial output exceeded limit (${opts.maxOutputBytes} bytes)`,
            "OUTPUT_LIMIT"
          );
        }

        if (predicate(this.buffer)) return;
        if (Date.now() - start > opts.timeoutMs) {
          throw new SerialRunnerError("Timed out waiting on serial output", opts.timeoutCode);
        }

        await new Promise<void>((resolve) => {
          this.notifyWaiters.push(resolve);
          // Also wake periodically to enforce timeouts even if no new data.
          setTimeout(resolve, 25);
        });
      }
    } finally {
      this.waiting = false;
    }
  }
}

export async function createSerialRunner(
  options: CreateSerialRunnerOptions
): Promise<SerialRunner> {
  const {
    vmId,
    pipeDir,
    serialConsole,
    createConsoleFn,
    connectTimeoutMs = 30000,
    defaultCommandTimeoutMs = 60000,
    defaultMaxOutputBytes = 512 * 1024,
  } = options;

  const console =
    serialConsole ??
    (await (createConsoleFn ?? createSerialConsole)({
      vmId,
      pipeDir,
    }));

  return new SerialRunner(console, {
    connectTimeoutMs,
    defaultCommandTimeoutMs,
    defaultMaxOutputBytes,
  });
}

function includesLoginPrompt(text: string): boolean {
  // Be permissive: getty often prints hostname prefixes like `localhost login:`.
  return /\blogin:\s*$/im.test(text) || /\bpassword:\s*$/im.test(text);
}

function looksLikeShellPrompt(text: string): boolean {
  // Heuristic: last line ends with $ or # (with optional trailing space).
  // This is intentionally loose; connect() sets a deterministic PS1 anyway.
  const lastLine = text.split(/\r?\n/).at(-1) ?? "";
  return /[#$]\s*$/.test(lastLine);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
}

function stripMarkers(segment: string, beginMarker: string): string {
  // Remove the echoed begin marker line if present.
  let out = segment;
  const beginIdx = out.indexOf(beginMarker);
  if (beginIdx !== -1) {
    const nl = out.indexOf("\n", beginIdx);
    out = nl === -1 ? "" : out.slice(nl + 1);
  }
  return out.replace(/\r/g, "");
}
