import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("./integration-store", () => ({
  getTodoIntegration: async () => ({ taskRules: undefined }),
}));
vi.mock("./storage", () => ({
  assertTodoOwner: vi.fn((userId: string) => {
    if (userId !== "owner") throw new Error("Owner required");
  }),
}));
import { requestTodoAnalysis } from "./ai";
it("includes the Markdown time policy in the actual AI request with the configured cutoff", async () => {
  const fetchMock = vi.fn(async () => Response.json({ choices: [] }));
  vi.stubGlobal("fetch", fetchMock);
  await requestTodoAnalysis("owner", {
    messages: [
      { role: "system", content: "Original deadline instructions" },
      { role: "user", content: "Example task" },
    ],
    tools: [],
  });
  const options = (
    fetchMock.mock.calls[0] as unknown as [string, RequestInit]
  )[1];
  const messages = JSON.parse(options.body as string).messages;
  expect(messages[0].content).toContain("Original deadline instructions");
  expect(messages[0].content).toContain(
    "currently configured cutoff for this request is **05:00**",
  );
  expect(messages[0].content).not.toContain("{{LATE_NIGHT_CUTOFF}}");
  expect(messages[1]).toEqual({ role: "user", content: "Example task" });
});
afterEach(() => vi.unstubAllGlobals());
it("uses shared quota and a named feature while preserving the deadline prompt and restricting models to free endpoints", async () => {
  const fetchMock = vi.fn(async () =>
    Response.json({ choices: [] }, { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const result = await requestTodoAnalysis("owner", {
    messages: [{ role: "user", content: "Sample task" }],
    tools: [{ type: "function", function: { name: "record_deadline" } }],
    models: ["paid-model"],
    provider: { max_price: { prompt: 999 } },
    stream: true,
  });
  expect(result.status).toBe(200);
  const [url, options] = fetchMock.mock.calls[0] as unknown as [
    string,
    RequestInit,
  ];
  expect(url).toContain("127.0.0.1:3010");
  expect(options.headers).toMatchObject({
    "x-inbox-zero-feature": "Todo deadline and work estimate",
    "x-inbox-zero-items": "1",
  });
  const body = JSON.parse(options.body as string);
  expect(body.models.every((model: string) => model.endsWith(":free"))).toBe(
    true,
  );
  expect(body.provider.max_price).toEqual({ prompt: 0, completion: 0 });
  expect(body.stream).toBe(false);
  expect(body.reasoning).toEqual({ enabled: false, effort: "none" });
  expect(body.max_tokens).toBe(2048);
  expect(body.messages[0].content).toBe("Sample task");
  await expect(
    requestTodoAnalysis("other", { messages: [], tools: [] }),
  ).rejects.toThrow("Owner");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("records note conversion separately in shared AI usage", async () => {
  const fetchMock = vi.fn(async () => Response.json({ choices: [] }));
  vi.stubGlobal("fetch", fetchMock);
  await requestTodoAnalysis("owner", { messages: [], tools: [] }, "notes");
  expect(
    (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers,
  ).toMatchObject({
    "x-inbox-zero-feature": "Note to task summary and deadline",
  });
});
