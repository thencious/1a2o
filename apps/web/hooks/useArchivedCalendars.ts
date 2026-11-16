"use client";

import { useSyncExternalStore } from "react";
import {
  getArchivedCalendars,
  getServerArchivedCalendars,
  subscribeArchivedCalendars,
} from "@/utils/calendar/calendar-archive";

export function useArchivedCalendars() {
  return useSyncExternalStore(
    subscribeArchivedCalendars,
    getArchivedCalendars,
    getServerArchivedCalendars,
  );
}
