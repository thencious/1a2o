"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { swrFetcher } from "@/providers/swr-fetcher";
import type {
  LoadEmailStatsResponse,
  ScanEmailHistoryResponse,
} from "@/app/api/user/stats/load/route";

export function useInboxScan(
  accounts: {
    id: string;
    email: string;
    account?: { disconnectedAt?: string | null };
  }[],
  refresh: () => Promise<unknown>,
) {
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(0);
  const [paused, setPaused] = useState("");
  const active = useRef<AbortController | null>(null);
  const seen = useRef(new Set<string>());
  const latest = useRef(refresh);
  latest.current = refresh;
  const scan = useCallback(
    async (manual: boolean) => {
      if (
        active.current ||
        (!manual &&
          accounts.every(
            (account) =>
              account.account?.disconnectedAt || seen.current.has(account.id),
          ))
      )
        return;
      const controller = new AbortController();
      active.current = controller;
      setLoading(true);
      setErrors([]);
      setLoaded(0);
      try {
        for (const account of accounts) {
          if (controller.signal.aborted) break;
          if (
            account.account?.disconnectedAt ||
            (!manual && seen.current.has(account.id))
          )
            continue;
          seen.current.add(account.id);
          const storageKey = `bulk-unsubscribe-history-v1:${account.id}`;
          const checkpoint = readCheckpoint(storageKey);
          const post = async (body: object) => {
            for (let attempt = 0; ; attempt++) {
              try {
                const result = await swrFetcher(
                  "/api/user/stats/load",
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                    signal: controller.signal,
                  },
                  account.id,
                );
                setPaused("");
                return result;
              } catch (error) {
                if (
                  (error as { status?: number }).status !== 429 ||
                  attempt >= 3 ||
                  controller.signal.aborted
                )
                  throw error;
                setPaused(
                  `Email provider limit reached for ${account.email}. Scan paused; retrying automatically.`,
                );
                await pauseScan(30_000 * 2 ** attempt, controller.signal);
              }
            }
          };
          try {
            if (!manual && checkpoint.complete) {
              const result: LoadEmailStatsResponse = await post({
                loadBefore: false,
              });
              setLoaded((total) => total + result.loadedAfterMessages);
              await latest.current();
              continue;
            }
            let pageToken = checkpoint.pageToken;
            const deadline = Date.now() + 10 * 60_000;
            do {
              if (controller.signal.aborted) break;
              if (Date.now() > deadline) throw new Error("Scan paused");
              const result: ScanEmailHistoryResponse = await post({
                fullScan: true,
                ...(pageToken ? { pageToken } : {}),
              });
              if (result.nextPageToken && result.nextPageToken === pageToken)
                throw new Error("Scan did not advance");
              pageToken = result.nextPageToken ?? undefined;
              saveCheckpoint(storageKey, { pageToken, complete: !pageToken });
              setLoaded((total) => total + result.loadedMessages);
              await latest.current();
              if (pageToken) await pauseScan(1000, controller.signal);
            } while (pageToken);
          } catch {
            if (controller.signal.aborted) seen.current.delete(account.id);
            else setErrors((current) => [...current, account.email]);
          }
        }
      } finally {
        if (active.current === controller) {
          active.current = null;
          setLoading(false);
          setPaused("");
        }
      }
    },
    [accounts],
  );
  useEffect(() => {
    if (!loading) scan(false);
  }, [scan, loading]);
  useEffect(() => () => active.current?.abort(), []);
  return { loading, errors, loaded, paused, scan };
}

function readCheckpoint(key: string): {
  pageToken?: string;
  complete?: boolean;
} {
  try {
    const data = JSON.parse(localStorage.getItem(key) ?? "{}");
    if (!data || typeof data !== "object") return {};
    return {
      pageToken:
        typeof data.pageToken === "string" ? data.pageToken : undefined,
      complete: data.complete === true,
    };
  } catch {
    return {};
  }
}
function saveCheckpoint(
  key: string,
  value: { pageToken?: string; complete: boolean },
) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Scanning also works without persistent browser storage. */
  }
}

function pauseScan(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted)
      return reject(new DOMException("Aborted", "AbortError"));
    const done = () => {
      signal.removeEventListener("abort", cancel);
      resolve();
    };
    const timer = setTimeout(done, ms);
    const cancel = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", cancel, { once: true });
  });
}
