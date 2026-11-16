import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  files: new Map<string, string>(),
  tasks: [] as (() => Promise<void>)[],
}));
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({
  after: (task: () => Promise<void>) => mocks.tasks.push(task),
}));
vi.mock("@/utils/error", () => ({ SafeError: class extends Error {} }));
vi.mock("@/utils/encryption", () => ({
  encryptToken: (text: string) => `encrypted:${text}`,
  decryptToken: (text: string) => text.slice(10),
}));
vi.mock("node:fs", () => ({ existsSync: () => true }));
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => undefined),
  readFile: vi.fn(async (file: string) => {
    if (!mocks.files.has(file))
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return mocks.files.get(file);
  }),
  writeFile: vi.fn(async (file: string, text: string) => {
    mocks.files.set(file, text);
  }),
  rename: vi.fn(async (from: string, to: string) => {
    mocks.files.set(to, mocks.files.get(from)!);
    mocks.files.delete(from);
  }),
}));
let service: typeof import("./local-rules-service");
const item = { id: "chat-a", title: "Example", text: "Project", version: "1" };
describe("saved conversation rules", () => {
  it("retries a rejected batch once as two smaller batches with original IDs", async () => {
    const rules = (await service.getLocalRules("owner", "messages")).rules;
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { message: "Provider rejected batch" } }),
        { status: 400 },
      ),
    );
    const result = await service.matchLocalRules("messages", rules, [
      item,
      { ...item, id: "chat-b" },
    ]);
    expect([...result.keys()]).toEqual(["chat-a", "chat-b"]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  beforeEach(async () => {
    vi.resetModules();
    mocks.files.clear();
    mocks.tasks.length = 0;
    vi.stubEnv("LOCAL_BEEPER_OWNER_ID", "owner");
    vi.stubEnv("DEFAULT_LLMS", "openrouter:test:free");
    vi.stubEnv("OPENROUTER_API_KEY", "test-only");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      results: [{ id: "0", ruleId: "business" }],
                    }),
                  },
                },
              ],
            }),
            { status: 200 },
          ),
      ),
    );
    service = await import("./local-rules-service");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it("schedules one batch, saves labels, and never reclassifies unchanged conversations", async () => {
    await service.labelRuleItems("owner", "messages", [item]);
    await service.labelRuleItems("owner", "messages", [item]);
    expect(mocks.tasks).toHaveLength(1);
    await mocks.tasks[0]();
    expect(
      (await service.labelRuleItems("owner", "messages", [item]))[item.id],
    ).toBe("Business");
    expect(mocks.tasks).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      [...mocks.files.values()].every((text) => text.startsWith("encrypted:")),
    ).toBe(true);
  });
  it("preserves labels when paused and rejects a stale settings save", async () => {
    await service.labelRuleItems("owner", "messages", [item]);
    await mocks.tasks[0]();
    const settings = await service.getLocalRules("owner", "messages");
    await service.setLocalRules("owner", {
      domain: "messages",
      revision: settings.revision,
      enabled: false,
      rules: settings.rules,
    });
    expect(
      (
        await service.labelRuleItems("owner", "messages", [
          { ...item, version: "2" },
        ])
      )[item.id],
    ).toBe("Business");
    expect(mocks.tasks).toHaveLength(1);
    await expect(
      service.setLocalRules("owner", {
        domain: "messages",
        revision: settings.revision,
        enabled: true,
        rules: settings.rules,
      }),
    ).rejects.toThrow("another window");
  });
  it("holds changed conversations until the next UTC day, including across restarts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-02T23:58:00Z"));
    await service.labelRuleItems("owner", "messages", [item]);
    await mocks.tasks[0]();
    vi.resetModules();
    service = await import("./local-rules-service");
    await service.labelRuleItems("owner", "messages", [
      { ...item, text: "Changed", version: "2" },
    ]);
    const settings = await service.getLocalRules("owner", "messages");
    await service.setLocalRules("owner", {
      domain: "messages",
      revision: settings.revision,
      enabled: true,
      rules: settings.rules,
    });
    await service.labelRuleItems("owner", "messages", [
      { ...item, version: "3" },
    ]);
    expect(mocks.tasks).toHaveLength(1);
    vi.setSystemTime(new Date("2026-11-03T00:00:00Z"));
    await service.labelRuleItems("owner", "messages", [
      { ...item, version: "3" },
    ]);
    expect(mocks.tasks).toHaveLength(2);
    await mocks.tasks[1]();
    await service.labelRuleItems("owner", "messages", [
      { ...item, version: "4" },
    ]);
    expect(mocks.tasks).toHaveLength(2);
    vi.setSystemTime(new Date("2026-11-04T00:00:00Z"));
    await service.labelRuleItems("owner", "messages", [
      { ...item, version: "3" },
    ]);
    expect(mocks.tasks).toHaveLength(2);
  });
  it("classifies a new conversation while an existing one is on its daily cooldown", async () => {
    await service.labelRuleItems("owner", "messages", [item]);
    await mocks.tasks[0]();
    const context = vi.fn(async (_value: typeof item) => "Context");
    await service.labelRuleItems(
      "owner",
      "messages",
      [
        { ...item, version: "2" },
        { ...item, id: "new-chat" },
      ],
      context,
    );
    await mocks.tasks[1]();
    expect(context.mock.calls.map(([value]) => value.id)).toEqual(["new-chat"]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("does not repeatedly retry an existing conversation after a failed daily refresh", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-02T12:00:00Z"));
    await service.labelRuleItems("owner", "messages", [item]);
    await mocks.tasks[0]();
    vi.setSystemTime(new Date("2026-11-03T12:00:00Z"));
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("busy", { status: 429 }),
    );
    await service.labelRuleItems("owner", "messages", [
      { ...item, version: "2" },
    ]);
    await mocks.tasks[1]();
    vi.setSystemTime(new Date("2026-11-03T13:00:00Z"));
    await service.labelRuleItems("owner", "messages", [
      { ...item, version: "3" },
    ]);
    expect(mocks.tasks).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("does not expose the owner's labels to another user", async () => {
    await expect(
      service.getLocalRules("someone-else", "messages"),
    ).rejects.toThrow("owner");
    expect(
      await service.labelRuleItems("someone-else", "calendars", [item]),
    ).toEqual({});
    expect(mocks.tasks).toHaveLength(0);
  });
  it("retains pending work with a backoff after an upstream failure", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("busy", { status: 429 }),
    );
    await service.labelRuleItems("owner", "messages", [item]);
    await mocks.tasks[0]();
    const state = await service.getLocalRules("owner", "messages");
    expect(state.retryAt).toBeGreaterThan(Date.now());
    expect(state.lastError).toContain("retry");
    await service.labelRuleItems("owner", "messages", [item]);
    expect(mocks.tasks).toHaveLength(1);
  });
});
