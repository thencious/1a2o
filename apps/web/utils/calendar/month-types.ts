export type MonthCalendar = {
  id: string;
  connectionId: string;
  calendarId: string;
  name: string;
  accountEmail: string;
  provider: string;
  writable: boolean;
  primary: boolean;
};

export type MonthEvent = {
  ruleLabel?: string | null;
  id: string;
  calendarKey: string;
  title: string;
  description: string;
  location: string;
  start: string;
  end: string;
  allDay: boolean;
  guests: string[];
  etag: string;
  editable: boolean;
  deletable?: boolean;
  readOnlyReason?: string;
  recurring: boolean;
  descriptionLocked: boolean;
  url?: string;
  conferenceUrl?: string;
};

export type CalendarMonth = {
  unavailableAccounts?: { provider: string; email: string }[];
  unavailableCalendarIds?: string[];
  calendars: MonthCalendar[];
  events: MonthEvent[];
  warnings: string[];
};
