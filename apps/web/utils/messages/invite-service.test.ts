import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { context, contacts, model } = vi.hoisted(() => ({
  context: vi.fn(),
  contacts: vi.fn(),
  model: vi.fn(),
}));
vi.mock("@/utils/beeper/service", () => ({
  getConversationInviteContext: context,
}));
vi.mock("@/utils/beeper/contacts", () => ({ cachedBeeperContacts: contacts }));
vi.mock("@/utils/linkedin/contacts", () => ({
  linkedInContactsStatus: async () => ({ account: null }),
}));
vi.mock("@/utils/calendar/defaults-store", () => ({
  getCalendarDefaults: async () => ({
    defaultCalendarId: null,
    meetingProvider: "google_meet",
    zoomMeetingUrl: "",
  }),
}));
vi.mock("@/utils/todo/integration-store", () => ({
  getTodoIntegration: async () => ({ taskRules: undefined }),
}));
import { prepareConversationInvite } from "./invite-service";

const result = () => ({
  found: true,
  title: "Project meeting",
  description: "",
  start: "2026-11-10T18:00:00Z",
  end: "2026-11-10T19:00:00Z",
  mode: "online",
  location: "",
  meeting_url: null,
  attendee_emails: [],
  participant_ids: ["alex"],
  source_message_ids: ["message"],
  warnings: [],
});
beforeEach(() => {
  vi.clearAllMocks();
  context.mockResolvedValue({
    title: "Alex chat",
    accountId: "wa",
    messages: [
      {
        id: "message",
        senderId: "alex",
        sender: "Alex Smith",
        text: "Let's meet online tomorrow",
        time: "2026-11-09T18:00:00Z",
        outgoing: false,
      },
    ],
    participants: [{ id: "alex", name: "Alex Smith", self: false }],
  });
  contacts.mockResolvedValue({ accounts: [] });
  model.mockImplementation(async () =>
    Response.json({
      choices: [{ message: { content: JSON.stringify(result()) } }],
    }),
  );
  vi.stubGlobal("fetch", model);
});
afterEach(() => vi.unstubAllGlobals());
describe("/invite preparation", () => {
  it("returns an unsent email request draft when the conversation and exact-name contacts provide no email", async () => {
    expect(
      await prepareConversationInvite("owner", "chat", "America/Los_Angeles"),
    ).toEqual({
      kind: "email_request",
      text: "May I have your email for a meeting invite?",
    });
    expect(model).toHaveBeenCalledTimes(1);
    expect(model.mock.calls[0][0]).toContain("127.0.0.1:3010");
  });
  it("finds an email through an exact normalized name match in another app", async () => {
    contacts.mockResolvedValue({
      accounts: [
        {
          id: "li",
          name: "LinkedIn",
          network: "LinkedIn",
          contacts: [
            { id: "li-alex", name: " alex  smith ", email: "alex@example.org" },
          ],
          pages: 1,
          fetchedAt: null,
        },
      ],
    });
    const prepared = await prepareConversationInvite(
      "owner",
      "chat",
      "America/Los_Angeles",
    );
    expect(prepared.kind).toBe("invitation");
    if (prepared.kind !== "invitation") throw new Error("Expected proposal");
    expect(prepared.proposal.guests).toEqual(["alex@example.org"]);
    expect(prepared.proposal.conference).toBe("google_meet");
    expect(model).toHaveBeenCalledTimes(1);
  });
  it("does not fuzzy-match a different person's name", async () => {
    contacts.mockResolvedValue({
      accounts: [
        {
          id: "li",
          name: "LinkedIn",
          network: "LinkedIn",
          contacts: [
            { id: "li-other", name: "Alex Smythe", email: "other@example.org" },
          ],
          pages: 1,
          fetchedAt: null,
        },
      ],
    });
    expect(
      (await prepareConversationInvite("owner", "chat", "America/Los_Angeles"))
        .kind,
    ).toBe("email_request");
  });
  it("does not draft or send invitations when no meeting discussion is found", async () => {
    model.mockResolvedValueOnce(
      Response.json({
        choices: [
          {
            message: { content: JSON.stringify({ ...result(), found: false }) },
          },
        ],
      }),
    );
    await expect(
      prepareConversationInvite("owner", "chat", "America/Los_Angeles"),
    ).rejects.toThrow("No meeting-organizing discussion");
  });
});
