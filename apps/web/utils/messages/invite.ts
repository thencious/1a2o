import { z } from "zod";

export type InviteLine = {
  id: string;
  senderId: string;
  sender: string;
  text: string;
  time: string;
  outgoing: boolean;
};
export const meetingExtraction = z.object({
  found: z.boolean(),
  title: z.string().max(512),
  description: z.string().max(4000),
  start: z.string().nullable(),
  end: z.string().nullable(),
  mode: z.enum(["physical", "online", "unspecified"]),
  location: z.string().max(2000),
  meeting_url: z.string().nullable(),
  attendee_emails: z.array(z.string()).max(100),
  participant_ids: z.array(z.string()).max(100),
  source_message_ids: z.array(z.string()).max(50),
  warnings: z.array(z.string().max(500)).max(20),
});

export function lastConversationLines(messages: InviteLine[], limit = 50) {
  const sorted = [
    ...new Map(messages.map((message) => [message.id, message])).values(),
  ].sort(
    (a, b) =>
      Date.parse(a.time) - Date.parse(b.time) || a.id.localeCompare(b.id),
  );
  const lines = sorted.flatMap((message) =>
    message.text
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((text) => ({ ...message, text })),
  );
  return lines.slice(-limit);
}

export function validatedInvite(
  extracted: z.infer<typeof meetingExtraction>,
  lines: InviteLine[],
  participants: { id: string; emails: string[] }[],
) {
  const warnings = [...extracted.warnings];
  const emails = new Set(
    lines
      .flatMap(
        (line) =>
          line.text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [],
      )
      .concat(participants.flatMap((person) => person.emails))
      .map((email) => email.toLowerCase()),
  );
  const validEmail = z.email();
  const guests = [
    ...new Set(
      extracted.attendee_emails.filter(
        (email) =>
          validEmail.safeParse(email).success &&
          emails.has(email.toLowerCase()),
      ),
    ),
  ];
  for (const id of guests.length ? [] : extracted.participant_ids) {
    const person = participants.find((person) => person.id === id);
    if (
      person?.emails.length === 1 &&
      !guests.some((email) =>
        person.emails.some(
          (candidate) => candidate.toLowerCase() === email.toLowerCase(),
        ),
      )
    )
      guests.push(person.emails[0]);
    if (
      person &&
      person.emails.length > 1 &&
      !guests.some((email) =>
        person.emails.some(
          (candidate) => candidate.toLowerCase() === email.toLowerCase(),
        ),
      )
    )
      warnings.push(
        "A participant has multiple email addresses. Choose the correct guest address.",
      );
  }
  const instant = z.iso.datetime({ offset: true });
  let start =
    extracted.start && instant.safeParse(extracted.start).success
      ? new Date(extracted.start).toISOString()
      : null;
  let end =
    extracted.end && instant.safeParse(extracted.end).success
      ? new Date(extracted.end).toISOString()
      : null;
  if (start && !end) {
    end = new Date(Date.parse(start) + 30 * 60_000).toISOString();
    warnings.push("No end time was agreed; a 30-minute meeting is suggested.");
  }
  if (start && end && Date.parse(end) <= Date.parse(start)) {
    start = null;
    end = null;
    warnings.push("The meeting time needs clarification.");
  }
  const ids = new Set(lines.map((line) => line.id));
  if (
    !extracted.source_message_ids.length ||
    extracted.source_message_ids.some((id) => !ids.has(id))
  )
    throw new Error(
      "The meeting could not be tied to the recent conversation. Please try again.",
    );
  let meetingUrl: string | null = null;
  if (extracted.meeting_url) {
    try {
      const url = new URL(extracted.meeting_url);
      if (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        lines.some((line) => line.text.includes(extracted.meeting_url!))
      )
        meetingUrl = url.href;
    } catch {}
  }
  if (!start) warnings.push("Add the agreed meeting date and start time.");
  if (!guests.length)
    warnings.push(
      "No guest email was available. Add the invitee’s email address.",
    );
  return {
    title: extracted.title,
    description: extracted.description,
    start,
    end,
    guests,
    location: meetingUrl ?? extracted.location,
    mode: extracted.mode,
    hasMeetingUrl: Boolean(meetingUrl),
    warnings: [...new Set(warnings)],
  };
}
export type PreparedMessageInvite = ReturnType<typeof validatedInvite> & {
  conference: "none" | "google_meet" | "zoom";
  candidateEmails: string[];
};
export type MessageInviteResult =
  | { kind: "email_request"; text: string }
  | { kind: "invitation"; proposal: PreparedMessageInvite };
