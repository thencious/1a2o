"use client";
import useSWR from "swr";
import { calendarDefaults } from "@/utils/calendar/defaults";
import { useUser } from "@/hooks/useUser";

export function useCalendarDefaults() {
  const { data: user } = useUser();
  return useSWR(
    user?.id ? ["/api/user/calendar/defaults", user.id] : null,
    async ([url]: [string, string]) => {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok)
        throw new Error(
          "Could not load your default calendar and meeting settings.",
        );
      return calendarDefaults.parse(await response.json());
    },
    { revalidateOnFocus: false },
  );
}
