"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import useSWR, { useSWRConfig } from "swr";
import type { CalendarMonth } from "@/utils/calendar/month-types";
import {
  CALENDAR_CACHE_PREFIX,
  mergeCalendarMonth,
  readCalendarMonthCache,
  updateCalendarMonthCache,
} from "@/utils/calendar/month-cache";

export function useCalendarMonth(userId: string, params: URLSearchParams) {
  const url = `/api/user/calendar/month?${params}`;
  const storageKey = CALENDAR_CACHE_PREFIX + userId;
  const { fetcher } = useSWRConfig();
  const getSnapshot = useCallback(() => {
    try {
      return localStorage.getItem(storageKey);
    } catch {
      return null;
    }
  }, [storageKey]);
  const raw = useSyncExternalStore(subscribe, getSnapshot, serverSnapshot);
  const fallbackData = useMemo(
    () => readCalendarMonthCache(raw, url),
    [raw, url],
  );
  const result = useSWR<CalendarMonth>(
    { url, userId },
    async ({ url }: { url: string }) => {
      const fresh = (await fetcher!(url)) as CalendarMonth;
      let previous: CalendarMonth | undefined;
      try {
        previous = readCalendarMonthCache(
          localStorage.getItem(storageKey),
          url,
        );
      } catch {}
      return mergeCalendarMonth(previous, fresh);
    },
    {
      fallbackData,
      refreshInterval: 60_000,
      revalidateOnFocus: true,
      revalidateOnMount: true,
      onSuccess(data) {
        try {
          localStorage.setItem(
            storageKey,
            updateCalendarMonthCache(
              localStorage.getItem(storageKey),
              url,
              data,
            ),
          );
          window.dispatchEvent(new Event("calendar-month-cache"));
        } catch {
          /* A full or unavailable cache must not interrupt calendar use. */
        }
      },
    },
  );
  return { ...result, isLoading: result.isLoading && !result.data };
}

function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener("calendar-month-cache", listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener("calendar-month-cache", listener);
  };
}

function serverSnapshot() {
  return null;
}
