import { describe, expect, it } from "vitest";
import { createSerialRunner, SerialRunnerError } from "./serial-runner";
import type { SerialConsole } from "./serial";

function createScriptedConsole(script: {
  onWrite: (data: string, emit: (text: string) => void) => void;
}): SerialConsole {
  let active = true;
  let onDataCb: ((data: Uint8Array) => void) | null = null;
  const encoder = new TextEncoder();

  const emit = (text: string) => {
    if (!active) return;
    onDataCb?.(encoder.encode(text));
  };

  return {
    write: async (data) => {
      const str = typeof data === "string" ? data : new TextDecoder().decode(data);
      script.onWrite(str, emit);
    },
    onData: (cb) => {
      onDataCb = cb;
    },
    close: async () => {
      active = false;
    },
    isActive: () => active,
    getPaths: () => ({ stdin: "/tmp/mock.stdin", stdout: "/tmp/mock.stdout" }),
  };
}

describe("SerialRunner", () => {
  it("connect() fails fast on login prompt", async () => {
    const serialConsole = createScriptedConsole({
      onWrite: (_data, emit) => {
        emit("login:\n");
      },
    });

    const runner = await createSerialRunner({ vmId: "vm-1", serialConsole, connectTimeoutMs: 200 });

    await expect(runner.connect()).rejects.toMatchObject({
      name: "SerialRunnerError",
      code: "LOGIN_PROMPT",
    });
  });

  it("connect() succeeds after setting deterministic PS1", async () => {
    const serialConsole = createScriptedConsole({
      onWrite: (data, emit) => {
        const m = data.match(/export PS1=\"([^\"]+)\"/);
        if (m) {
          // Emit a prompt that includes the token.
          emit(`\n${m[1]}`);
        }
      },
    });

    const runner = await createSerialRunner({ vmId: "vm-1", serialConsole, connectTimeoutMs: 200 });
    await runner.connect();
    await runner.close();
  });

  it("run() returns output and exit code based on markers", async () => {
    const serialConsole = createScriptedConsole({
      onWrite: (data, emit) => {
        // Make connect() succeed.
        const ps1 = data.match(/export PS1=\"([^\"]+)\"/);
        if (ps1) {
          emit(`\n${ps1[1]}`);
          return;
        }

        const begin = data.match(/echo (__BF_BEGIN__[0-9a-f-]+)/);
        const end = data.match(/echo (__BF_END__[0-9a-f-]+:)(\$\?)/);
        if (begin && end) {
          const beginMarker = begin[1];
          const endPrefix = end[1];
          emit(`${beginMarker}\nOK\n${endPrefix}0\n`);
        }
      },
    });

    const runner = await createSerialRunner({
      vmId: "vm-1",
      serialConsole,
      connectTimeoutMs: 200,
      defaultCommandTimeoutMs: 200,
    });
    await runner.connect();

    const result = await runner.run("echo hi");
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("OK");

    await runner.close();
  });

  it("run() errors on output limit", async () => {
    const serialConsole = createScriptedConsole({
      onWrite: (data, emit) => {
        const ps1 = data.match(/export PS1=\"([^\"]+)\"/);
        if (ps1) {
          emit(`\n${ps1[1]}`);
          return;
        }

        const begin = data.match(/echo (__BF_BEGIN__[0-9a-f-]+)/);
        const end = data.match(/echo (__BF_END__[0-9a-f-]+:)(\$\?)/);
        if (begin && end) {
          const beginMarker = begin[1];
          const endPrefix = end[1];
          emit(`${beginMarker}\n${"x".repeat(2048)}\n${endPrefix}0\n`);
        }
      },
    });

    const runner = await createSerialRunner({
      vmId: "vm-1",
      serialConsole,
      connectTimeoutMs: 200,
      defaultCommandTimeoutMs: 200,
      defaultMaxOutputBytes: 512,
    });
    await runner.connect();

    await expect(runner.run("echo hi")).rejects.toBeInstanceOf(SerialRunnerError);
    await runner.close();
  });
});
