import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { finish } = vi.hoisted(() => ({ finish: vi.fn() }));
vi.mock("@/utils/chatgpt/oauth", () => ({ finishChatGPTLogin: finish }));
vi.mock("@/utils/error", () => ({
  SafeError: class SafeError extends Error {},
}));
import { GET } from "./route";

beforeEach(() => {
  finish.mockReset().mockResolvedValue(undefined);
});

it("completes the original loopback callback after Next.js normalizes its hostname", async () => {
  const request = new NextRequest(
    "http://127.0.0.1:3000/auth/callback?state=fixture-state&code=fixture-code&client_id=oaiapp_fixture",
  );
  expect(new URL(request.url).hostname).toBe("localhost");
  const response = await GET(request);
  expect(response.status).toBe(200);
  expect(finish).toHaveBeenCalledOnce();
  expect(finish.mock.calls[0][0].get("code")).toBe("fixture-code");
  expect(await response.text()).toContain("Connected to ChatGPT");
  expect(response.headers.get("cache-control")).toBe("no-store");
});

it.each([
  "http://evil.test/auth/callback",
  "https://127.0.0.1:3000/auth/callback",
])("rejects a non-local or non-loopback-protocol callback: %s", async (url) => {
  const response = await GET(
    new Request(url, { headers: { "x-forwarded-host": "127.0.0.1:3000" } }),
  );
  expect(response.status).toBe(400);
  expect(finish).not.toHaveBeenCalled();
});

it("does not report success when state or identity verification fails", async () => {
  finish.mockRejectedValue(new Error("Invalid state"));
  const response = await GET(
    new NextRequest("http://127.0.0.1:3000/auth/callback?state=invalid"),
  );
  expect(finish).toHaveBeenCalledOnce();
  expect(response.status).toBe(400);
  expect(await response.text()).not.toContain("Connected to ChatGPT");
});
