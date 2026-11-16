import { convert } from "html-to-text";
import type { calendar_v3 } from "@googleapis/calendar";
import type { Client } from "@microsoft/microsoft-graph-client";
import { getCalendarClientWithRefresh as googleClient } from "./client";
import { getCalendarClientWithRefresh as microsoftClient } from "@/utils/outlook/calendar-client";
import type { Logger } from "@/utils/logger";
import { SafeError } from "@/utils/error";
import type { MonthCalendar, MonthEvent } from "./month-types";
import type { SaveMonthEvent } from "@/utils/actions/calendar-month.validation";
import { isGoogleVirtualCalendarId } from "./providers/google-calendar-id";
import { googleEventPermissions } from "./google-event-permissions";

export type MonthConnection = {
  id: string;
  email: string;
  provider: string;
  emailAccountId: string;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: Date | null;
};

export interface MonthProvider {
  calendar(id: string): Promise<MonthCalendar>;
  calendars(): Promise<MonthCalendar[]>;
  events(
    calendar: MonthCalendar,
    start: string,
    end: string,
  ): Promise<MonthEvent[]>;
  remove(calendar: MonthCalendar, eventId: string, etag: string): Promise<void>;
  save(calendar: MonthCalendar, input: SaveMonthEvent): Promise<{ id: string }>;
}

export async function createMonthProvider(
  connection: MonthConnection,
  logger: Logger,
): Promise<MonthProvider> {
  const credentials = {
    ...connection,
    connectionId: connection.id,
    expiresAt: connection.expiresAt?.getTime() ?? null,
    logger,
  };
  if (connection.provider === "google")
    return new GoogleMonthProvider(connection, await googleClient(credentials));
  if (connection.provider === "microsoft")
    return new MicrosoftMonthProvider(
      connection,
      await microsoftClient(credentials),
    );
  throw new SafeError("Unsupported calendar provider.");
}

class GoogleMonthProvider implements MonthProvider {
  private readonly connection: MonthConnection;
  private readonly client: calendar_v3.Calendar;
  constructor(connection: MonthConnection, client: calendar_v3.Calendar) {
    this.connection = connection;
    this.client = client;
  }
  private metadata(item: calendar_v3.Schema$CalendarListEntry): MonthCalendar {
    return {
      id: JSON.stringify([this.connection.id, item.id]),
      connectionId: this.connection.id,
      calendarId: item.id!,
      name: item.summaryOverride || item.summary || "Untitled calendar",
      accountEmail: this.connection.email,
      provider: "google",
      primary: item.primary === true,
      writable:
        ["owner", "writer"].includes(item.accessRole ?? "") &&
        !isGoogleVirtualCalendarId(item.id ?? ""),
    };
  }
  async calendars() {
    const result: MonthCalendar[] = [];
    let pageToken: string | undefined;
    do {
      const { data } = await this.client.calendarList.list(
        { maxResults: 250, pageToken },
        { timeout: 20_000 },
      );
      result.push(
        ...(data.items ?? [])
          .filter(
            (item) =>
              item.id && !item.deleted && item.accessRole !== "freeBusyReader",
          )
          .map((item) => this.metadata(item)),
      );
      pageToken = data.nextPageToken ?? undefined;
    } while (pageToken);
    return result;
  }
  async calendar(id: string) {
    const { data } = await this.client.calendarList.get(
      { calendarId: id },
      { timeout: 20_000 },
    );
    return this.metadata(data);
  }
  private event(
    item: calendar_v3.Schema$Event,
    calendar: MonthCalendar,
  ): MonthEvent {
    return {
      id: item.id!,
      calendarKey: calendar.id,
      title: item.summary || "(No title)",
      description: item.description ?? "",
      location: item.location ?? "",
      start: item.start?.date ?? item.start?.dateTime ?? "",
      end: item.end?.date ?? item.end?.dateTime ?? "",
      allDay: Boolean(item.start?.date),
      guests: (item.attendees ?? []).flatMap((guest) =>
        guest.email ? [guest.email] : [],
      ),
      etag: item.etag ?? "",
      ...googleEventPermissions(item, calendar.writable),
      recurring: Boolean(item.recurringEventId),
      descriptionLocked: false,
      url: item.htmlLink ?? undefined,
      conferenceUrl:
        item.hangoutLink ??
        item.conferenceData?.entryPoints?.find(
          (entry) => entry.entryPointType === "video",
        )?.uri ??
        undefined,
    };
  }
  async events(calendar: MonthCalendar, start: string, end: string) {
    const result: MonthEvent[] = [];
    let pageToken: string | undefined;
    do {
      const { data } = await this.client.events.list(
        {
          calendarId: calendar.calendarId,
          timeMin: start,
          timeMax: end,
          singleEvents: true,
          orderBy: "startTime",
          maxResults: 2500,
          pageToken,
        },
        { timeout: 20_000 },
      );
      result.push(
        ...(data.items ?? [])
          .filter(
            (item) =>
              item.id && item.status !== "cancelled" && item.start && item.end,
          )
          .map((item) => this.event(item, calendar)),
      );
      pageToken = data.nextPageToken ?? undefined;
      if (pageToken && result.length >= 20_000)
        throw new SafeError("This calendar has too many events in this month.");
    } while (pageToken);
    return result;
  }
  private async editable(
    calendar: MonthCalendar,
    eventId: string,
    etag: string,
    deleting = false,
  ) {
    const { data } = await this.client.events.get(
      { calendarId: calendar.calendarId, eventId },
      { timeout: 20_000 },
    );
    const permission = googleEventPermissions(data, calendar.writable);
    if (!(deleting ? permission.deletable : permission.editable))
      throw new SafeError(
        deleting
          ? "This event cannot be deleted from this calendar."
          : (permission.readOnlyReason ?? "This event cannot be edited."),
      );
    if (data.etag !== etag)
      throw new SafeError(
        "This event changed elsewhere. Close it, refresh, and reopen it before saving.",
      );
    return data;
  }
  async save(calendar: MonthCalendar, input: SaveMonthEvent) {
    const existing = input.eventId
      ? await this.editable(calendar, input.eventId, input.etag!)
      : undefined;
    const body: calendar_v3.Schema$Event = {
      summary: input.title,
      description: input.description,
      location: input.location,
      start: input.allDay ? { date: input.start } : { dateTime: input.start },
      end: input.allDay ? { date: input.end } : { dateTime: input.end },
      attendees: input.guests.map(
        (email) =>
          existing?.attendees?.find(
            (guest) => guest.email?.toLowerCase() === email.toLowerCase(),
          ) ?? { email },
      ),
      ...(input.conference === "google_meet"
        ? {
            conferenceData: {
              createRequest: {
                requestId: input.requestId,
                conferenceSolutionKey: { type: "hangoutsMeet" },
              },
            },
          }
        : {}),
    };
    if (input.eventId) {
      const { data } = await this.client.events.patch(
        {
          calendarId: calendar.calendarId,
          eventId: input.eventId,
          sendUpdates: "all",
          conferenceDataVersion:
            input.conference === "google_meet" ? 1 : undefined,
          requestBody: body,
        },
        { headers: { "If-Match": input.etag! }, timeout: 20_000 },
      );
      return { id: data.id! };
    }
    const id = input.requestId.replaceAll("-", "");
    try {
      const { data } = await this.client.events.insert(
        {
          calendarId: calendar.calendarId,
          sendUpdates: "all",
          conferenceDataVersion:
            input.conference === "google_meet" ? 1 : undefined,
          requestBody: { ...body, id },
        },
        { timeout: 20_000 },
      );
      return { id: data.id! };
    } catch (error) {
      if (Number((error as { code?: number }).code) !== 409) throw error;
      const { data } = await this.client.events.get(
        { calendarId: calendar.calendarId, eventId: id },
        { timeout: 20_000 },
      );
      if (data.status === "cancelled")
        throw new SafeError(
          "This event was deleted. Start a new event to create another.",
        );
      return { id: data.id! };
    }
  }
  async remove(calendar: MonthCalendar, eventId: string, etag: string) {
    const existing = await this.editable(calendar, eventId, etag, true);
    await this.client.events.delete(
      {
        calendarId: calendar.calendarId,
        eventId,
        sendUpdates:
          existing.eventType !== "fromGmail" &&
          (existing.organizer?.self === true || !existing.organizer?.email)
            ? "all"
            : "none",
      },
      { headers: { "If-Match": etag }, timeout: 20_000 },
    );
  }
}

type GraphCalendar = {
  id: string;
  name?: string;
  canEdit?: boolean;
  isDefaultCalendar?: boolean;
};
type GraphEvent = {
  id: string;
  subject?: string;
  body?: { content?: string; contentType?: string };
  bodyPreview?: string;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  isAllDay?: boolean;
  originalStartTimeZone?: string;
  isOrganizer?: boolean;
  isCancelled?: boolean;
  type?: string;
  isOnlineMeeting?: boolean;
  webLink?: string;
  location?: { displayName?: string };
  attendees?: { emailAddress?: { address?: string }; type?: string }[];
  "@odata.etag"?: string;
};

class MicrosoftMonthProvider implements MonthProvider {
  private readonly connection: MonthConnection;
  private readonly client: Client;
  constructor(connection: MonthConnection, client: Client) {
    this.connection = connection;
    this.client = client;
  }
  private path(id: string) {
    return `/me/calendars/${encodeURIComponent(id)}`;
  }
  private metadata(item: GraphCalendar): MonthCalendar {
    return {
      id: JSON.stringify([this.connection.id, item.id]),
      connectionId: this.connection.id,
      calendarId: item.id,
      name: item.name || "Untitled calendar",
      accountEmail: this.connection.email,
      provider: "microsoft",
      primary: item.isDefaultCalendar === true,
      writable: item.canEdit === true,
    };
  }
  async calendars() {
    const result: MonthCalendar[] = [];
    let next: string | undefined = "/me/calendars?$top=100";
    while (next) {
      const data = (await this.client.api(next).get()) as {
        value?: GraphCalendar[];
        "@odata.nextLink"?: string;
      };
      result.push(...(data.value ?? []).map((item) => this.metadata(item)));
      next = data["@odata.nextLink"];
    }
    return result;
  }
  async calendar(id: string) {
    return this.metadata(
      (await this.client.api(this.path(id)).get()) as GraphCalendar,
    );
  }
  private event(item: GraphEvent, calendar: MonthCalendar): MonthEvent {
    const instant = (value: string) =>
      /Z$|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`;
    const date = (value?: string) =>
      item.isAllDay ? (value ?? "").slice(0, 10) : instant(value ?? "");
    return {
      id: item.id,
      calendarKey: calendar.id,
      title: item.subject || "(No title)",
      description: item.body?.content
        ? item.body.contentType?.toLowerCase() === "html"
          ? convert(item.body.content, { wordwrap: false })
          : item.body.content
        : (item.bodyPreview ?? ""),
      start: date(item.start?.dateTime),
      end: date(item.end?.dateTime),
      allDay: item.isAllDay === true,
      location: item.location?.displayName ?? "",
      guests: (item.attendees ?? []).flatMap((guest) =>
        guest.emailAddress?.address ? [guest.emailAddress.address] : [],
      ),
      etag: item["@odata.etag"] ?? "",
      editable:
        calendar.writable && item.isOrganizer === true && !item.isCancelled,
      deletable: calendar.writable && !item.isCancelled,
      readOnlyReason: !calendar.writable
        ? "This calendar is read-only. Its owner controls editing access."
        : item.isOrganizer !== true
          ? "This meeting is organized by someone else. Create an editable copy to make your own version."
          : undefined,
      recurring: item.type === "occurrence" || item.type === "exception",
      descriptionLocked: item.isOnlineMeeting === true,
      url: item.webLink,
    };
  }
  async events(calendar: MonthCalendar, start: string, end: string) {
    const params = new URLSearchParams({
      startDateTime: start,
      endDateTime: end,
      $top: "500",
    });
    let next: string | undefined =
      `${this.path(calendar.calendarId)}/calendarView?${params}`;
    const result: MonthEvent[] = [];
    while (next) {
      const data = (await this.client
        .api(next)
        .header("Prefer", 'outlook.timezone="UTC"')
        .get()) as { value?: GraphEvent[]; "@odata.nextLink"?: string };
      const items = (data.value ?? []).filter((item) => !item.isCancelled);
      for (let offset = 0; offset < items.length; offset += 4) {
        const normalized = await Promise.all(
          items.slice(offset, offset + 4).map(async (item) => {
            // All-day dates float in the event's own timezone. UTC conversion can
            // otherwise move a London or Asian all-day event into the previous day.
            if (
              item.isAllDay &&
              item.originalStartTimeZone &&
              item.originalStartTimeZone !== "UTC"
            ) {
              const original = (await this.client
                .api(
                  `${this.path(calendar.calendarId)}/events/${encodeURIComponent(item.id)}`,
                )
                .header(
                  "Prefer",
                  `outlook.timezone="${item.originalStartTimeZone}"`,
                )
                .get()) as GraphEvent;
              return this.event(original, calendar);
            }
            return this.event(item, calendar);
          }),
        );
        result.push(...normalized);
      }
      next = data["@odata.nextLink"];
      if (next && result.length >= 20_000)
        throw new SafeError("This calendar has too many events in this month.");
    }
    return result;
  }
  private async editable(
    calendar: MonthCalendar,
    eventId: string,
    etag: string,
    deleting = false,
  ) {
    const data = (await this.client
      .api(
        `${this.path(calendar.calendarId)}/events/${encodeURIComponent(eventId)}`,
      )
      .header("Prefer", 'outlook.timezone="UTC"')
      .get()) as GraphEvent;
    const permission = this.event(data, calendar);
    if (!(deleting ? permission.deletable : permission.editable))
      throw new SafeError("This event can only be edited by its organizer.");
    if (data["@odata.etag"] !== etag)
      throw new SafeError(
        "This event changed elsewhere. Close it, refresh, and reopen it before saving.",
      );
    return data;
  }
  async save(calendar: MonthCalendar, input: SaveMonthEvent) {
    const existing = input.eventId
      ? await this.editable(calendar, input.eventId, input.etag!)
      : undefined;
    const body: Record<string, unknown> = {
      subject: input.title,
      isAllDay: input.allDay,
      start: {
        dateTime: input.allDay
          ? `${input.start}T00:00:00`
          : input.start.replace(/Z$/, ""),
        timeZone: input.allDay
          ? existing?.originalStartTimeZone || input.timezone || "UTC"
          : "UTC",
      },
      end: {
        dateTime: input.allDay
          ? `${input.end}T00:00:00`
          : input.end.replace(/Z$/, ""),
        timeZone: input.allDay
          ? existing?.originalStartTimeZone || input.timezone || "UTC"
          : "UTC",
      },
      location: { displayName: input.location },
    };
    const previous = existing && this.event(existing, calendar);
    if (!previous || previous.description !== input.description) {
      if (previous?.descriptionLocked)
        throw new SafeError(
          "Edit this online meeting's notes in Outlook to preserve its meeting link.",
        );
      body.body = { contentType: "text", content: input.description };
    }
    if (
      !previous ||
      JSON.stringify(previous.guests) !== JSON.stringify(input.guests)
    )
      body.attendees = input.guests.map(
        (address) =>
          existing?.attendees?.find(
            (guest) =>
              guest.emailAddress?.address?.toLowerCase() ===
              address.toLowerCase(),
          ) ?? { emailAddress: { address }, type: "required" },
      );
    const endpoint = `${this.path(calendar.calendarId)}/events`;
    const result = input.eventId
      ? await this.client
          .api(`${endpoint}/${encodeURIComponent(input.eventId)}`)
          .header("If-Match", input.etag!)
          .patch(body)
      : await this.client
          .api(endpoint)
          .post({ ...body, transactionId: input.requestId });
    return { id: (result as GraphEvent).id };
  }
  async remove(calendar: MonthCalendar, eventId: string, etag: string) {
    await this.editable(calendar, eventId, etag, true);
    await this.client
      .api(
        `${this.path(calendar.calendarId)}/events/${encodeURIComponent(eventId)}`,
      )
      .header("If-Match", etag)
      .delete();
  }
}
