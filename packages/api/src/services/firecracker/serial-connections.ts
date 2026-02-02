import type { SerialConsole } from "./serial";

// NOTE: Serial FIFOs are not safely readable by multiple consumers.
// This registry enforces a single active connection per VM so we can keep
// output deterministic for both terminal WS and serial bootstrap.

const activeConnections = new Map<string, SerialConsole>();

export function hasActiveSerialConnection(vmId: string): boolean {
  return activeConnections.has(vmId);
}

export function getActiveSerialConnection(vmId: string): SerialConsole | undefined {
  return activeConnections.get(vmId);
}

export function setActiveSerialConnection(vmId: string, console: SerialConsole): void {
  activeConnections.set(vmId, console);
}

export function clearActiveSerialConnection(vmId: string, console?: SerialConsole): void {
  const current = activeConnections.get(vmId);
  if (!current) return;
  if (console && current !== console) return;
  activeConnections.delete(vmId);
}

export function getActiveSerialConnectionCount(): number {
  return activeConnections.size;
}

export async function closeAllSerialConnections(): Promise<void> {
  const promises: Promise<void>[] = [];
  for (const [vmId, console] of activeConnections) {
    promises.push(
      console.close().finally(() => {
        activeConnections.delete(vmId);
      })
    );
  }
  await Promise.all(promises);
}
