"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { swrFetcher } from "@/providers/swr-fetcher";
import type {
  LoadEmailStatsResponse,
  ScanEmailHistoryResponse,
} from "@/app/api/user/stats/load/route";

export function useInboxScan(
  accounts: { id: string; email: string }[],
  refresh: () => Promise<unknown>,
) {
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(0);
  const active = useRef<AbortController | null>(null);
  const seen = useRef(new Set<string>());
  const latest = useRef(refresh);
  latest.current = refresh;
  const scan = useCallback(
    async (manual: boolean) => {
      if (
        active.current ||
        (!manual && accounts.every((account) => seen.current.has(account.id)))
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
          if (!manual && seen.current.has(account.id)) continue;
          seen.current.add(account.id);
          const storageKey = `bulk-unsubscribe-history-v1:${account.id}`;
          const checkpoint = readCheckpoint(storageKey);
          const post = (body: object) =>
            swrFetcher(
              "/api/user/stats/load",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
                signal: controller.signal,
              },
              account.id,
            );
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
        }
      }
    },
    [accounts],
  );
  useEffect(() => {
    if (!loading) scan(false);
  }, [scan, loading]);
  useEffect(() => () => active.current?.abort(), []);
  return { loading, errors, loaded, scan };
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
