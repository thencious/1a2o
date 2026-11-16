import { describe, expect, it } from "vitest";
import { dayEventLayout } from "./day-layout";
import type { MonthEvent } from "./month-types";
const day = new Date(2026, 9, 30);
function event(id: string, startHour: number, endHour: number): MonthEvent {
  return {
    id,
    calendarKey: "work",
    title: id,
    description: "",
    location: "",
    start: new Date(2026, 9, 30, startHour).toISOString(),
    end: new Date(2026, 9, 30, endHour).toISOString(),
    allDay: false,
    guests: [],
    etag: "1",
    editable: true,
    recurring: false,
    descriptionLocked: false,
  };
}
describe("day timeline layout", () => {
  it("gives overlapping events separate lanes and reuses lanes after an event ends", () => {
    const items = dayEventLayout(
      [
        event("a", 9, 11),
        event("b", 10, 12),
        event("c", 11, 12),
        event("d", 13, 14),
      ],
      day,
    );
    expect(
      items.map((item) => [item.start, item.end, item.lane, item.lanes]),
    ).toEqual([
      [540, 660, 0, 2],
      [600, 720, 1, 2],
      [660, 720, 0, 2],
      [780, 840, 0, 1],
    ]);
  });
  it("clips overnight events to the day and keeps all-day events out of the hour grid", () => {
    const overnight = event("night", -2, 2),
      late = event("late", 23, 26),
      allDay = { ...event("all", 0, 24), allDay: true };
    expect(
      dayEventLayout([overnight, late, allDay], day).map((item) => [
        item.start,
        item.end,
      ]),
    ).toEqual([
      [0, 120],
      [1380, 1440],
    ]);
  });
});
