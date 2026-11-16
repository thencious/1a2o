import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ context: vi.fn(), write: vi.fn() }));
vi.mock("@/utils/beeper/service", () => ({
  getConversationInviteContext: mocks.context,
}));
vi.mock("@/utils/contacts/directory", () => ({
  contactDirectory: async () => ({ accounts: [] }),
}));
vi.mock("@/utils/contacts/local-store", () => ({
  updateSavedContacts: mocks.write,
}));
import { addConversationContacts } from "./add-contacts-service";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it("uses exactly the newest 100 lines in one quota-limited request and only then commits attributable contacts", async () => {
  mocks.context.mockResolvedValue({
    participants: [{ id: "alice", name: "Alice" }],
    messages: [
      {
        id: "m",
        senderId: "alice",
        sender: "Alice",
        time: "2026-11-09T10:00:00Z",
        outgoing: false,
        text: Array.from({ length: 150 }, (_, index) => `Line ${index}`)
          .concat("My email is alice@example.org")
          .join("\n"),
      },
    ],
  });
  const fetchMock = vi.fn(async () =>
    Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              contacts: [
                {
                  name: "Alice",
                  participant_id: "alice",
                  facts: [
                    {
                      kind: "email",
                      label: "",
                      value: "alice@example.org",
                      source_message_id: "m",
                    },
                  ],
                },
              ],
            }),
          },
        },
      ],
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  mocks.write.mockImplementation(async (_user, update) => update([]));
  expect(await addConversationContacts("owner", "chat")).toMatchObject({
    created: 1,
    updated: 0,
    lines: 100,
  });
  expect(mocks.context).toHaveBeenCalledWith("owner", "chat", 100);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, options] = fetchMock.mock.calls[0] as unknown as [
    string,
    RequestInit,
  ];
  expect(url).toContain("127.0.0.1:3010");
  expect(options.headers).toMatchObject({
    "x-inbox-zero-feature": "Messages /add contact extraction",
  });
  const payload = JSON.parse(
    JSON.parse(options.body as string).messages[1].content,
  );
  expect(payload.lines).toHaveLength(100);
  expect(payload.lines[0].text).toBe("Line 51");
  expect(payload.lines.at(-1).text).toBe("My email is alice@example.org");
});
it("leaves contacts unchanged when the provider or its structured output fails", async () => {
  mocks.context.mockResolvedValue({
    participants: [],
    messages: [
      {
        id: "m",
        senderId: "a",
        sender: "A",
        time: "2026-11-09T10:00:00Z",
        outgoing: false,
        text: "Sample",
      },
    ],
  });
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ error: "quota" }, { status: 429 }))
    .mockResolvedValueOnce(Response.json({ choices: [] }));
  vi.stubGlobal("fetch", fetchMock);
  await expect(addConversationContacts("owner", "chat")).rejects.toThrow("429");
  await expect(addConversationContacts("owner", "chat")).rejects.toThrow(
    "usable",
  );
  expect(mocks.write).toHaveBeenCalledTimes(2);
});
it("saves the direct-chat phone even when AI extracts nothing from an outgoing note", async () => {
  mocks.context.mockResolvedValue({
    title: "+1 (555) 555-0199",
    type: "single",
    accountId: "whatsapp",
    participants: [
      { id: "me", name: "Alex Rivera", email: "owner@example.org", self: true },
    ],
    messages: [
      {
        id: "m",
        senderId: "me",
        sender: "You",
        text: "Note to self",
        time: "2026-11-13T21:57:00Z",
        outgoing: true,
      },
    ],
  });
  const fetchMock = vi.fn().mockResolvedValue(
    Response.json({
      choices: [{ message: { content: JSON.stringify({ contacts: [] }) } }],
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  let saved: unknown;
  mocks.write.mockImplementation(async (_user, update) => {
    const result = await update([]);
    saved = result.contacts;
    return result;
  });
  expect(await addConversationContacts("owner", "chat")).toMatchObject({
    created: 1,
    profiles: 1,
  });
  expect(saved).toEqual([
    expect.objectContaining({
      name: "+1 (555) 555-0199",
      phoneNumber: "+1 (555) 555-0199",
    }),
  ]);
});
it("keeps authoritative profile import available when AI is unavailable or there are no text messages", async () => {
  const context = {
    title: "Alex",
    type: "single",
    accountId: "whatsapp",
    participants: [{ id: "peer", name: "Alex", phoneNumber: "+15555550123" }],
    messages: [
      {
        id: "m",
        senderId: "peer",
        sender: "Alex",
        text: "Hello",
        time: "2026-11-13T21:57:00Z",
        outgoing: false,
      },
    ],
  };
  mocks.context.mockResolvedValue(context);
  mocks.write.mockImplementation(async (_user, update) => update([]));
  const fetchMock = vi
    .fn()
    .mockResolvedValue(Response.json({}, { status: 429 }));
  vi.stubGlobal("fetch", fetchMock);
  expect(await addConversationContacts("owner", "chat")).toMatchObject({
    created: 1,
    warnings: [expect.stringContaining("additional details")],
  });
  mocks.context.mockResolvedValue({ ...context, messages: [] });
  expect(await addConversationContacts("owner", "chat")).toMatchObject({
    created: 1,
    lines: 0,
    warnings: [],
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
