import type { MonthEvent } from "./month-types";

export function dayEventLayout(events: MonthEvent[], day: Date) {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  const items = events
    .filter((event) => !event.allDay)
    .map((event) => {
      const from = new Date(event.start),
        to = new Date(event.end);
      return {
        event,
        start: from < start ? 0 : from.getHours() * 60 + from.getMinutes(),
        end: to >= end ? 1440 : to.getHours() * 60 + to.getMinutes(),
        lane: 0,
        lanes: 1,
      };
    })
    .filter((item) => item.end > item.start)
    .sort((a, b) => a.start - b.start || b.end - a.end);
  let group: typeof items = [];
  let laneEnds: number[] = [];
  let groupEnd = 0;
  const finish = () => {
    for (const item of group) item.lanes = laneEnds.length;
    group = [];
    laneEnds = [];
  };
  for (const item of items) {
    if (item.start >= groupEnd) finish();
    let lane = laneEnds.findIndex((end) => end <= item.start);
    if (lane < 0) lane = laneEnds.length;
    item.lane = lane;
    laneEnds[lane] = item.end;
    group.push(item);
    groupEnd = Math.max(...laneEnds);
  }
  finish();
  return items;
}
