import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import { agentSessions } from "../db/schema";

export type AgentSessionWatchdogThresholds = {
  /** Fallback for creating sessions without a recognized progress message. */
  defaultCreatingMs: number;
  /** Per-step timeouts (keyed by `agent_sessions.error_message` while status=creating). */
  byMessage: Record<string, number>;
};

export type StartAgentSessionWatchdogOptions = {
  db: BetterSQLite3Database<typeof schema>;
  intervalMs?: number;
  thresholds?: Partial<AgentSessionWatchdogThresholds>;
  now?: () => number;
};

const DEFAULT_THRESHOLDS: AgentSessionWatchdogThresholds = {
  defaultCreatingMs: 10 * 60 * 1000,
  byMessage: {
    "Bootstrapping: connecting serial": 60 * 1000,
    "Bootstrapping: configuring network": 2 * 60 * 1000,
    "Bootstrapping: preparing workspace": 2 * 60 * 1000,
    "Bootstrapping: cloning repo": 8 * 60 * 1000,
    "Bootstrapping: starting OpenCode": 2 * 60 * 1000,
    "Bootstrapping: waiting for OpenCode health": 2 * 60 * 1000,
  },
};

function mergeThresholds(
  overrides: Partial<AgentSessionWatchdogThresholds> | undefined
): AgentSessionWatchdogThresholds {
  if (!overrides) return DEFAULT_THRESHOLDS;
  return {
    defaultCreatingMs: overrides.defaultCreatingMs ?? DEFAULT_THRESHOLDS.defaultCreatingMs,
    byMessage: {
      ...DEFAULT_THRESHOLDS.byMessage,
      ...(overrides.byMessage ?? {}),
    },
  };
}

function coerceTimestampMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) {
    // Drizzle may return integer timestamps as either seconds or milliseconds.
    // Heuristic: < 1e12 => seconds, else milliseconds.
    return value < 1e12 ? value * 1000 : value;
  }
  return 0;
}

export function startAgentSessionWatchdog(options: StartAgentSessionWatchdogOptions): () => void {
  const intervalMs = options.intervalMs ?? 15_000;
  const thresholds = mergeThresholds(options.thresholds);
  const now = options.now ?? (() => Date.now());

  let stopped = false;

  const tick = async () => {
    if (stopped) return;

    const sessions = await options.db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.status, "creating"));

    const currentTime = now();
    for (const session of sessions) {
      const updatedAt = coerceTimestampMs(session.updatedAt as unknown);
      if (!updatedAt) continue;

      const message = session.errorMessage ?? "";
      const thresholdMs = thresholds.byMessage[message] ?? thresholds.defaultCreatingMs;

      if (currentTime - updatedAt < thresholdMs) continue;

      const step = message || "Bootstrapping";
      const errorMessage =
        `${step} stalled (no progress for ${Math.round((currentTime - updatedAt) / 1000)}s). ` +
        `This often happens if the API restarts during bootstrap. Click Retry.`;

      await options.db
        .update(agentSessions)
        .set({
          status: "error",
          errorMessage,
          updatedAt: new Date(),
        })
        .where(eq(agentSessions.id, session.id));
    }
  };

  // Run once immediately so stale sessions don't linger.
  tick().catch((err) => {
    console.error("[AgentSessionWatchdog] Initial tick failed:", err);
  });

  const timer = setInterval(() => {
    tick().catch((err) => {
      console.error("[AgentSessionWatchdog] Tick failed:", err);
    });
  }, intervalMs);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
