import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import { vms } from "../db/schema";
import { NetworkService } from "./network";
import { cleanupVMPipes } from "./firecracker/process";
import { readFile, unlink } from "fs/promises";

export type StartVmWatchdogOptions = {
  db: BetterSQLite3Database<typeof schema>;
  networkService: NetworkService;
  intervalMs?: number;
  now?: () => number;
};

async function isFirecrackerPidAlive(pid: number, socketPath?: string | null): Promise<boolean> {
  try {
    const cmdline = await readFile(`/proc/${pid}/cmdline`);
    const text = cmdline.toString("utf8").replace(/\0/g, " ");
    if (!/\bfirecracker\b/.test(text)) return false;
    if (socketPath && !text.includes(socketPath)) return false;
    return true;
  } catch {
    return false;
  }
}

export function startVmWatchdog(options: StartVmWatchdogOptions): () => void {
  const intervalMs = options.intervalMs ?? 20_000;
  const now = options.now ?? (() => Date.now());
  let stopped = false;

  const tick = async () => {
    if (stopped) return;

    const running = await options.db.select().from(vms).where(eq(vms.status, "running"));
    for (const vm of running) {
      if (!vm.pid || !vm.socketPath) continue;

      const alive = await isFirecrackerPidAlive(vm.pid, vm.socketPath);
      if (alive) continue;

      // Firecracker pid is dead (or PID reused). Reconcile DB and clean up resources.
      console.warn(
        `[VmWatchdog] VM ${vm.id} marked running but firecracker pid ${vm.pid} is not alive; reconciling to stopped.`
      );

      try {
        await options.networkService.release({
          tapDevice: vm.tapDevice ?? undefined,
          ipAddress: vm.ipAddress ?? undefined,
        });
      } catch (err) {
        console.warn(`[VmWatchdog] Failed to release network for VM ${vm.id}:`, err);
      }

      try {
        await cleanupVMPipes(vm.id);
      } catch {
        // cleanupVMPipes is best-effort internally, but keep watchdog resilient
      }

      try {
        await unlink(vm.socketPath).catch(() => {});
      } catch {
        // ignore
      }

      await options.db
        .update(vms)
        .set({
          status: "stopped",
          pid: null,
          socketPath: null,
          tapDevice: null,
          macAddress: null,
          ipAddress: null,
          updatedAt: new Date(now()),
        })
        .where(eq(vms.id, vm.id));
    }
  };

  tick().catch((err) => {
    console.error("[VmWatchdog] Initial tick failed:", err);
  });

  const timer = setInterval(() => {
    tick().catch((err) => {
      console.error("[VmWatchdog] Tick failed:", err);
    });
  }, intervalMs);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
