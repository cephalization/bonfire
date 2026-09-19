import { describe, it, expect } from "vitest";
import { createMockSSHService } from "../ssh";
import {
  buildOpencodeConfig,
  buildProvisionScript,
  isSafeWorkspaceName,
  provisionAgent,
} from "./provisioner";

describe("buildOpencodeConfig", () => {
  it("puts provider keys under provider.<id>.options and allows tools", () => {
    const config = buildOpencodeConfig({ anthropic: "sk-a", openai: "", google: "g" });
    expect(config).toMatchObject({
      permission: "allow",
      share: "disabled",
      autoupdate: false,
      provider: {
        anthropic: { options: { apiKey: "sk-a" } },
        google: { options: { apiKey: "g" } },
      },
    });
    expect((config.provider as Record<string, unknown>).openai).toBeUndefined();
  });
});

describe("buildProvisionScript", () => {
  it("writes the config, reuses a healthy server and otherwise starts one", () => {
    const script = buildProvisionScript({
      configJson: '{"a":1}',
      password: "it's-secret",
      workspace: "conv-1",
    });
    expect(script).toContain(
      `echo ${Buffer.from('{"a":1}').toString("base64")} | base64 -d > /home/agent/.config/opencode/opencode.json`
    );
    expect(script).toContain("chmod 600 /home/agent/.config/opencode/opencode.json");
    expect(script).toContain("mkdir -p '/home/agent/workspaces/conv-1'");
    // Password is shell-quoted, including the apostrophe.
    expect(script).toContain(`-u opencode:'it'\\''s-secret' http://127.0.0.1:4096/api/health`);
    expect(script).toContain("OPENCODE_SERVER_PASSWORD='it'\\''s-secret'");
    expect(script).toContain("serve --hostname 0.0.0.0 --port 4096");
  });
});

describe("isSafeWorkspaceName", () => {
  it("accepts ids and rejects path tricks", () => {
    expect(isSafeWorkspaceName("3f2a-4b")).toBe(true);
    expect(isSafeWorkspaceName("../etc")).toBe(false);
    expect(isSafeWorkspaceName("a b")).toBe(false);
    expect(isSafeWorkspaceName("")).toBe(false);
  });
});

describe("provisionAgent", () => {
  it("runs the script over SSH as the agent user and reports whether it started a server", async () => {
    const ssh = createMockSSHService();
    ssh.setCommandResponse(/bash -s/, { stdout: "STARTED\n", stderr: "", code: 0 });

    const result = await provisionAgent({
      host: "10.0.100.2",
      privateKey: "key",
      sshService: ssh,
      providerKeys: { anthropic: "sk" },
      password: "pw",
      workspace: "conv-1",
    });

    expect(result).toEqual({ directory: "/home/agent/workspaces/conv-1", started: true });
    expect(ssh.calls.connect[0].config).toMatchObject({ host: "10.0.100.2", username: "agent" });
    expect(ssh.calls.exec[0].command).toContain("bash -s <<'BONFIRE_EOF'");
    expect(ssh.calls.exec[0].command).toContain("OPENCODE_SERVER_PASSWORD='pw'");
    expect(ssh.calls.disconnect).toHaveLength(1);
  });

  it("surfaces a failing script", async () => {
    const ssh = createMockSSHService();
    ssh.setCommandResponse(/bash -s/, {
      stdout: "",
      stderr: "opencode is not installed in this VM",
      code: 3,
    });
    await expect(
      provisionAgent({
        host: "h",
        privateKey: "k",
        sshService: ssh,
        providerKeys: {},
        password: "pw",
        workspace: "conv-1",
      })
    ).rejects.toThrow("exit 3): opencode is not installed in this VM");
    expect(ssh.calls.disconnect).toHaveLength(1);
  });

  it("refuses an unsafe workspace name", async () => {
    await expect(
      provisionAgent({
        host: "h",
        privateKey: "k",
        sshService: createMockSSHService(),
        providerKeys: {},
        password: "pw",
        workspace: "../x",
      })
    ).rejects.toThrow("Invalid workspace name");
  });
});
