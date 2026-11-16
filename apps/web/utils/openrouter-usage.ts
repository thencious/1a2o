import "server-only";
import { SafeError } from "@/utils/error";

export type UsageReport = {
  day: string;
  generatedAt: string;
  total: number;
  counted: number;
  legacy: number;
  legacyBackfill: number;
  legacyUnattributed: number;
  firstTrackedAt: number | null;
  groups: Array<{
    feature: string;
    model: string;
    outcome: string;
    status: number | null;
    counted: number;
    calls: number;
    items: number | null;
  }>;
  hourly: Array<{
    hour: string;
    calls: number;
    failed: number;
    blocked: number;
  }>;
  history: Array<{
    day: string;
    calls: number;
    tracked: number;
    failed: number;
    blocked: number;
  }>;
  recent: Array<{
    at: number;
    feature: string;
    model: string;
    counted: number;
    outcome: string;
    status: number | null;
    duration_ms: number | null;
    items: number | null;
  }>;
  limits: {
    perDay: number;
    perMinute: number;
    dailyUsed: number;
    nextResetAt: string;
  };
};

export async function getOpenRouterUsage(
  userId: string,
  day: string,
): Promise<UsageReport> {
  if (
    userId !==
    (process.env.LOCAL_BEEPER_OWNER_ID || process.env.LOCAL_AGENTS_OWNER_ID)
  )
    throw new SafeError(
      "Usage is available only to this installation's owner.",
    );
  const response = await fetch(
    `http://127.0.0.1:3010/usage?day=${encodeURIComponent(day)}`,
    {
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok)
    throw new SafeError(
      response.status === 400
        ? "Choose a valid UTC date."
        : "Usage tracking is unavailable. Please retry shortly.",
    );
  return response.json();
}
