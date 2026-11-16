"use client";
import useSWR from "swr";
import type { AttentionTab } from "@/utils/attention/types";
export function useAttention() {
  return useSWR<{
    enabled: boolean;
    counts: Partial<Record<AttentionTab, number>>;
    through: number;
    activation?: { id: string; path: string; createdAt: number } | null;
  }>(
    "/api/user/attention",
    async (url) => {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load attention status");
      return response.json();
    },
    { refreshInterval: 3000, revalidateOnFocus: true },
  );
}
