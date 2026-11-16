import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ChatGPTAccount } from "./store";
const state = vi.hoisted(() => ({ account: null as ChatGPTAccount | null }));
vi.mock("server-only", () => ({}));
vi.mock("./oauth", () => ({
  assertLocalChatGPTOwner: vi.fn(),
  usableChatGPTAccount: async (_id: string, account: ChatGPTAccount) => account,
}));
vi.mock("./store", () => ({
  readChatGPTAccount: async () => state.account,
  updateChatGPTAccount: async (
    _id: string,
    update: (
      account: ChatGPTAccount,
    ) => Promise<{ account: ChatGPTAccount; result: unknown }>,
  ) => {
    const result = await update(state.account!);
    state.account = result.account;
    return result.result;
  },
}));
import { chatGPTModel, chatGPTStatus, configureChatGPT } from "./service";
beforeEach(() => {
  state.account = {
    hostId: "host",
    enabled: true,
    accessToken: "fixture-token",
    refreshToken: "fixture-refresh",
    clientId: "oaiapp_test",
    scopes: ["chatgpt.tokens.use.direct"],
  };
});
afterEach(() => vi.unstubAllGlobals());
it("reports a pending browser handoff across reloads without exposing OAuth state or claiming a connection", async () => {
  const expiresAt = Date.now() + 60_000;
  state.account = {
    hostId: "host",
    enabled: false,
    scopes: [],
    pendingLogin: { state: "private-oauth-state", expiresAt },
  };
  const status = await chatGPTStatus("owner");
  expect(status).toMatchObject({
    connected: false,
    enabled: false,
    pendingUntil: expiresAt,
    loginError: null,
  });
  expect(JSON.stringify(status)).not.toContain("private-oauth-state");
  state.account.pendingLogin!.expiresAt = Date.now() - 1;
  const expired = await chatGPTStatus("owner");
  expect(expired.pendingUntil).toBeNull();
  expect(expired.loginError).toContain("timed out");
});
it("keeps callback failures visible when no credentials were saved", async () => {
  state.account = {
    hostId: "host",
    enabled: false,
    scopes: [],
    loginError: "ChatGPT sign-in was declined. You can retry from Chat.",
  };
  expect(await chatGPTStatus("owner")).toMatchObject({
    connected: false,
    pendingUntil: null,
    loginError: state.account.loginError,
  });
});
it("uses account-specific models, strips credentials from status and creates a Responses model without fallbacks", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        models: [
          {
            slug: "account-model",
            display_name: "Account model",
            visibility: "list",
            default_reasoning_level: "low",
            supported_reasoning_levels: [
              { effort: "low", description: "Quick" },
              { effort: "high", description: "Deeper" },
              { effort: "max", description: "Maximum" },
              { effort: "ultra", description: "Client delegation" },
            ],
          },
          { slug: "hidden", display_name: "Hidden", visibility: "hidden" },
        ],
      }),
    ),
  );
  const status = await chatGPTStatus("owner");
  expect(status.models).toEqual([
    {
      id: "account-model",
      name: "Account model",
      defaultReasoning: "low",
      reasoningLevels: [
        { effort: "low", description: "Quick" },
        { effort: "high", description: "Deeper" },
        { effort: "max", description: "Maximum" },
      ],
    },
  ]);
  expect(JSON.stringify(status)).not.toContain("fixture-token");
  const model = await chatGPTModel("owner");
  expect(model).toMatchObject({
    provider: "chatgpt",
    modelName: "account-model",
    fallbackModels: [],
    providerOptions: { openai: { store: false, reasoningEffort: "low" } },
  });
  await configureChatGPT("owner", {
    mode: "reasoning",
    reasoningEffort: "high",
  });
  expect((await chatGPTStatus("owner")).reasoningEffort).toBe("high");
  expect((await chatGPTModel("owner"))?.providerOptions).toMatchObject({
    openai: { reasoningEffort: "high" },
  });
  await expect(
    configureChatGPT("owner", { mode: "reasoning", reasoningEffort: "none" }),
  ).rejects.toThrow("supported");
  await configureChatGPT("owner", { mode: "openrouter" });
  expect(await chatGPTModel("owner")).toBeUndefined();
  await expect(
    configureChatGPT("owner", { mode: "model", model: "hidden" }),
  ).rejects.toThrow("available");
});
it("falls back to the selected model's default when changing to one without the saved thinking level", async () => {
  state.account = {
    ...state.account!,
    model: "deep-model",
    reasoningEffort: "max",
    catalogAt: Date.now(),
    models: [
      {
        id: "deep-model",
        name: "Deep",
        defaultReasoning: "low",
        reasoningLevels: [
          { effort: "low", description: "Quick" },
          { effort: "max", description: "Deep" },
        ],
      },
      {
        id: "quick-model",
        name: "Quick",
        defaultReasoning: "low",
        reasoningLevels: [{ effort: "low", description: "Quick" }],
      },
    ],
  };
  await configureChatGPT("owner", { mode: "model", model: "quick-model" });
  expect((await chatGPTStatus("owner")).reasoningEffort).toBe("low");
  expect(state.account.reasoningEffort).toBe("low");
});
it("signs out locally without claiming revocation succeeded when the network fails", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("offline");
    }),
  );
  expect(await configureChatGPT("owner", { mode: "disconnect" })).toEqual({
    revocationConfirmed: false,
  });
  expect(state.account).toMatchObject({
    enabled: false,
    clientId: "oaiapp_test",
  });
  expect(state.account?.accessToken).toBeUndefined();
  expect(state.account?.refreshToken).toBeUndefined();
});

it("streams through the public Responses endpoint with storage disabled and the original tool schemas", async () => {
  state.account = {
    ...state.account!,
    model: "gpt-6.1-sol",
    reasoningEffort: "max",
    models: [
      {
        id: "gpt-6.1-sol",
        name: "GPT-6.1 Sol",
        defaultReasoning: "low",
        reasoningLevels: [
          { effort: "low", description: "Quick" },
          { effort: "max", description: "Deep" },
        ],
      },
    ],
    catalogAt: Date.now(),
  };
  const fetchMock = vi.fn(
    async () =>
      new Response("data: [DONE]\n\n", {
        headers: { "content-type": "text/event-stream" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const model = (await chatGPTModel("owner"))!;
  const result = await model.model.doStream({
    prompt: [{ role: "user", content: [{ type: "text", text: "Test" }] }],
    providerOptions: model.providerOptions,
    tools: [
      {
        type: "function",
        name: "searchInbox",
        description: "Find matching emails",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  });
  await result.stream.cancel();
  const [url, options] = fetchMock.mock.calls[0] as unknown as [
    string,
    RequestInit,
  ];
  expect(url).toBe("https://api.openai.com/v1/responses");
  expect(JSON.parse(options.body as string)).toMatchObject({
    model: "gpt-6.1-sol",
    store: false,
    stream: true,
    reasoning: { effort: "max" },
    tools: [{ type: "function", name: "searchInbox" }],
  });
});
