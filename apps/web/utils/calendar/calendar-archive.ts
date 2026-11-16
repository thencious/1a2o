// The original month-view filters stored unchecked calendar IDs under this key.
// Reuse them so existing unchecked calendars become archived without a reset.
const STORAGE_KEY = "inbox-zero-visible-calendars";
const CHANGE_EVENT = "inbox-zero-calendar-archive-changed";
const EMPTY: string[] = [];
let lastRaw: string | null | undefined;
let snapshot = EMPTY;

export function parseArchivedCalendars(raw: string | null) {
  try {
    const value: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(value) && value.every((id) => typeof id === "string")
      ? ([...new Set(value)] as string[])
      : [];
  } catch {
    return [];
  }
}

export function getArchivedCalendars() {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== lastRaw) {
      lastRaw = raw;
      snapshot = parseArchivedCalendars(raw);
    }
  } catch {}
  return snapshot;
}

export function getServerArchivedCalendars() {
  return EMPTY;
}

export function subscribeArchivedCalendars(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) listener();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function setCalendarArchived(id: string, archived: boolean) {
  const current = getArchivedCalendars();
  const next = archived
    ? [...new Set([...current, id])]
    : current.filter((value) => value !== id);
  const raw = JSON.stringify(next);
  try {
    localStorage.setItem(STORAGE_KEY, raw);
  } catch {}
  lastRaw = raw;
  snapshot = next;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function restoreAllCalendars() {
  try {
    localStorage.setItem(STORAGE_KEY, "[]");
  } catch {}
  lastRaw = "[]";
  snapshot = [];
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
