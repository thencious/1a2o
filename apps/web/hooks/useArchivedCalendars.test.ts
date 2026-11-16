// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  getArchivedCalendars,
  parseArchivedCalendars,
  restoreAllCalendars,
  setCalendarArchived,
} from "@/utils/calendar/calendar-archive";
import { useArchivedCalendars } from "./useArchivedCalendars";

const key = "inbox-zero-visible-calendars";
beforeEach(() => {
  localStorage.clear();
});

describe("calendar archive preferences", () => {
  it("uses the previous unchecked calendar IDs as archived on first read", () => {
    localStorage.setItem(
      key,
      JSON.stringify(["unchecked-google", "unchecked-outlook"]),
    );
    const view = renderHook(useArchivedCalendars);
    expect(view.result.current).toEqual([
      "unchecked-google",
      "unchecked-outlook",
    ]);
    expect(localStorage.getItem(key)).toBe(JSON.stringify(view.result.current));
    view.unmount();
  });
  it("updates the calendar view and settings together, preserving stored choices", () => {
    const month = renderHook(useArchivedCalendars);
    const settings = renderHook(useArchivedCalendars);
    act(() => setCalendarArchived("holiday", true));
    expect(month.result.current).toEqual(["holiday"]);
    expect(settings.result.current).toEqual(["holiday"]);
    act(() => setCalendarArchived("holiday", true));
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(["holiday"]);
    act(() => setCalendarArchived("work", true));
    act(() => setCalendarArchived("holiday", false));
    expect(month.result.current).toEqual(["work"]);
    act(() => restoreAllCalendars());
    expect(month.result.current).toEqual([]);
    expect(settings.result.current).toEqual([]);
    month.unmount();
    settings.unmount();
  });
  it("responds to another window changing the preference and keeps stable snapshots", () => {
    const view = renderHook(useArchivedCalendars);
    const previous = getArchivedCalendars();
    expect(getArchivedCalendars()).toBe(previous);
    act(() => {
      localStorage.setItem(key, '["other-window"]');
      window.dispatchEvent(new StorageEvent("storage", { key }));
    });
    expect(view.result.current).toEqual(["other-window"]);
    view.unmount();
  });
  it("ignores malformed data and removes duplicate archived IDs", () => {
    expect(parseArchivedCalendars("garbage")).toEqual([]);
    expect(parseArchivedCalendars('["work", false]')).toEqual([]);
    expect(parseArchivedCalendars('["work", "work"]')).toEqual(["work"]);
  });
});
