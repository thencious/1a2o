"use client";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { useUser } from "@/hooks/useUser";
import { getArchivedCalendars } from "@/utils/calendar/calendar-archive";
import { saveCalendarVisibilityAction } from "@/utils/actions/calendar-visibility";
import {
  calendarVisibility,
  type CalendarVisibility,
  type changeCalendarVisibility,
} from "@/utils/calendar/visibility";
import type { MonthCalendar } from "@/utils/calendar/month-types";
import type { z } from "zod";

export function useCalendarVisibility(calendars: MonthCalendar[]) {
  const { data: user } = useUser();
  const storageKey = `zenro:calendar-visibility:v1:${user?.id ?? ""}`;
  const fallbackData = useMemo(() => {
    if (!user?.id || typeof window === "undefined") return;
    try {
      return calendarVisibility.parse(
        JSON.parse(localStorage.getItem(storageKey) ?? "null"),
      );
    } catch {
      return;
    }
  }, [user?.id, storageKey]);
  const { data, error, mutate } = useSWR<CalendarVisibility>(
    user?.id ? ["/api/user/calendar/visibility", user.id] : null,
    ([url]: [string, string]) =>
      fetch(url).then(async (response) => {
        if (!response.ok)
          throw new Error("Could not load calendar preferences.");
        const result = calendarVisibility.parse(await response.json());
        try {
          localStorage.setItem(storageKey, JSON.stringify(result));
        } catch {}
        return result;
      }),
    { fallbackData },
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  async function save(change: z.infer<typeof changeCalendarVisibility>) {
    setSaving(true);
    setSaveError(undefined);
    try {
      const result = await saveCalendarVisibilityAction(change);
      if (!result?.data)
        throw new Error(
          result?.serverError ?? "Could not save calendar preferences.",
        );
      try {
        localStorage.setItem(storageKey, JSON.stringify(result.data));
      } catch {}
      await mutate(result.data, { revalidate: false });
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : "Could not save calendar preferences.",
      );
    } finally {
      setSaving(false);
    }
  }
  useEffect(() => {
    if (data?.visibleIds !== null || !calendars.length || saving || saveError)
      return;
    const archived = getArchivedCalendars();
    save({
      operation: "initialize",
      ids: calendars
        .filter((calendar) => !archived.includes(calendar.id))
        .map((calendar) => calendar.id),
    });
  }, [data, calendars, saving, saveError, save]);
  const visibleIds = new Set(data?.visibleIds ?? []);
  const hidden = calendars
    .filter((calendar) => !visibleIds.has(calendar.id))
    .map((calendar) => calendar.id);
  return {
    hidden,
    saving,
    loading: !data && !error,
    error:
      saveError ?? (error ? "Could not load calendar preferences." : undefined),
    toggle: (id: string, visible: boolean) =>
      save({ operation: "toggle", id, visible }),
    showAll: () =>
      save({
        operation: "replace",
        ids: calendars.map((calendar) => calendar.id),
      }),
    hideAll: () => save({ operation: "replace", ids: [] }),
  };
}
