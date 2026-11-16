import { describe, expect, it } from "vitest";
import {
  lastConversationLines,
  validatedInvite,
  type InviteLine,
} from "./invite";

const line = (id: number, text: string): InviteLine => ({
  id: String(id),
  senderId: "alex",
  sender: "Alex",
  outgoing: false,
  time: new Date(Date.UTC(2026, 10, 9, 8, id)).toISOString(),
  text,
});
const extraction = {
  found: true,
  title: "Meet Alex",
  description: "",
  start: "2026-11-10T14:00:00-08:00",
  end: null,
  mode: "physical" as const,
  location: "Riverside room",
  meeting_url: null,
  attendee_emails: [] as string[],
  participant_ids: ["alex"],
  source_message_ids: ["1"],
  warnings: [],
};
describe("conversation meeting proposals", () => {
  it("selects exactly the latest 50 nonempty lines across pages, preserving message identities and full line contents", () => {
    const long = "x".repeat(3000);
    const messages = Array.from({ length: 60 }, (_, i) => line(i, `line ${i}`));
    messages.push(line(60, `last one\n\n${long}`), messages[0]);
    const lines = lastConversationLines(messages.reverse());
    expect(lines).toHaveLength(50);
    expect(lines[0].id).toBe("12");
    expect(lines.at(-1)?.text).toBe(long);
    expect(lines.at(-1)?.id).toBe("60");
  });
  it("uses only the intended participant's known email and keeps the agreed physical venue", () => {
    const proposal = validatedInvite(
      extraction,
      [line(1, "Meet tomorrow in the Riverside room")],
      [
        { id: "alex", emails: ["alex@example.org"] },
        { id: "other", emails: ["other@example.org"] },
      ],
    );
    expect(proposal.guests).toEqual(["alex@example.org"]);
    expect(proposal.location).toBe("Riverside room");
    expect(proposal.start).toBe("2026-11-10T22:00:00.000Z");
    expect(proposal.end).toBe("2026-11-10T22:30:00.000Z");
  });
  it("prioritizes an email provided in conversation over an older contact email", () => {
    const proposal = validatedInvite(
      { ...extraction, attendee_emails: ["new@example.org"] },
      [line(1, "Send the invite to new@example.org")],
      [{ id: "alex", emails: ["old@example.org"] }],
    );
    expect(proposal.guests).toEqual(["new@example.org"]);
  });
  it("rejects invented guest addresses and does not choose between multiple contact emails", () => {
    const proposal = validatedInvite(
      { ...extraction, attendee_emails: ["invented@example.org"] },
      [line(1, "See you tomorrow")],
      [{ id: "alex", emails: ["one@example.org", "two@example.org"] }],
    );
    expect(proposal.guests).toEqual([]);
    expect(proposal.warnings.length).toBeGreaterThan(0);
  });
  it("uses an existing meeting link only when it actually occurs in the recent conversation", () => {
    const url = "https://meet.google.com/abc-defg-hij";
    expect(
      validatedInvite(
        { ...extraction, mode: "online", meeting_url: url },
        [line(1, `Use ${url}`)],
        [],
      ).location,
    ).toBe(url);
    expect(
      validatedInvite(
        { ...extraction, mode: "online", meeting_url: url, location: "" },
        [line(1, "Let's call")],
        [],
      ).hasMeetingUrl,
    ).toBe(false);
  });
  it("requires evidence inside the selected lines and leaves uncertain dates unset", () => {
    expect(() =>
      validatedInvite(
        { ...extraction, source_message_ids: ["outside"] },
        [line(1, "Let's meet")],
        [],
      ),
    ).toThrow("recent conversation");
    const proposal = validatedInvite(
      { ...extraction, start: "Tuesday", end: null },
      [line(1, "Tuesday maybe")],
      [],
    );
    expect(proposal.start).toBeNull();
    expect(proposal.end).toBeNull();
  });
});
