import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { generateKeyPair, exportJWK, SignJWT, type JSONWebKeySet } from "jose";
import type { ChatGPTAccount, ChatGPTAttempt } from "./store";
const state = vi.hoisted(() => ({
  accounts: new Map<string, ChatGPTAccount>(),
  attempts: new Map<string, ChatGPTAttempt>(),
  keys: { keys: [] } as JSONWebKeySet,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/env", () => ({
  env: { NEXT_PUBLIC_BASE_URL: "http://localhost:3000" },
}));
vi.mock("./store", () => ({
  updateChatGPTAccount: async (
    id: string,
    update: (
      account: ChatGPTAccount,
    ) => Promise<{ account: ChatGPTAccount; result: unknown }>,
  ) => {
    const result = await update(
      state.accounts.get(id) ?? {
        hostId: "urn:uuid:fixture-host",
        enabled: false,
        scopes: [],
      },
    );
    state.accounts.set(id, result.account);
    return result.result;
  },
  saveChatGPTAttempt: async (attempt: ChatGPTAttempt) =>
    state.attempts.set(attempt.state, attempt),
  consumeChatGPTAttempt: async (key: string) => {
    const attempt = state.attempts.get(key);
    state.attempts.delete(key);
    if (!attempt) throw new Error("Invalid state");
    return attempt;
  },
}));
vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  return {
    ...actual,
    createRemoteJWKSet:
      () =>
      (...args: Parameters<ReturnType<typeof actual.createLocalJWKSet>>) =>
        actual.createLocalJWKSet(state.keys)(...args),
  };
});
import {
  startChatGPTLogin,
  finishChatGPTLogin,
  usableChatGPTAccount,
} from "./oauth";
beforeEach(() => {
  state.accounts.clear();
  state.attempts.clear();
  vi.stubEnv("LOCAL_BEEPER_OWNER_ID", "owner");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
async function prepare(
  nonceOverride?: string,
  scope = "chatgpt.tokens.use.direct offline_access",
  subject = "subject",
) {
  const { url } = await startChatGPTLogin("owner");
  const query = new URL(url).searchParams;
  const attempt = state.attempts.get(query.get("state")!)!;
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  state.keys = {
    keys: [{ ...(await exportJWK(publicKey)), kid: "fixture", alg: "RS256" }],
  };
  const token = await new SignJWT({
    nonce: nonceOverride ?? attempt.nonce,
    email: "fixture@example.org",
  })
    .setProtectedHeader({ alg: "RS256", kid: "fixture" })
    .setIssuer("https://auth.openai.com")
    .setAudience("oaiapp_fixture")
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  const fetchMock = vi.fn(async () =>
    Response.json({
      access_token: "fixture-access",
      refresh_token: "fixture-refresh",
      id_token: token,
      expires_in: 3600,
      scope,
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return {
    query,
    attempt,
    fetchMock,
    callback: new URLSearchParams({
      state: attempt.state,
      code: "fixture-code",
      client_id: "oaiapp_fixture",
    }),
  };
}
it("registers with PKCE, binds a loopback callback, validates a signed identity and keeps tokens off the client", async () => {
  const { query, attempt, fetchMock, callback } = await prepare();
  expect(query.get("client_id")).toBe("dynamic_agent_client");
  expect(query.get("code_challenge")).toBe(
    createHash("sha256").update(attempt.verifier).digest("base64url"),
  );
  expect(query.get("redirect_uri")).toBe("http://127.0.0.1:3000/auth/callback");
  expect(state.accounts.get("owner")?.pendingLogin).toEqual({
    state: attempt.state,
    expiresAt: attempt.expiresAt,
  });
  await finishChatGPTLogin(callback);
  expect(state.accounts.get("owner")).toMatchObject({
    enabled: true,
    subject: "subject",
    clientId: "oaiapp_fixture",
  });
  expect(state.accounts.get("owner")?.pendingLogin).toBeUndefined();
  expect(state.accounts.get("owner")?.loginError).toBeUndefined();
  const [, options] = fetchMock.mock.calls[0] as unknown as [
    string,
    RequestInit,
  ];
  expect(
    new URLSearchParams(options.body as URLSearchParams).get("client_id"),
  ).toBe("oaiapp_fixture");
  await expect(finishChatGPTLogin(callback)).rejects.toThrow("state");
  await expect(startChatGPTLogin("other")).rejects.toThrow("owner");
});
it("rejects nonce mismatch and identity-only permission without changing the active account", async () => {
  let test = await prepare("incorrect");
  await expect(finishChatGPTLogin(test.callback)).rejects.toThrow("identity");
  expect(state.accounts.get("owner")?.accessToken).toBeUndefined();
  expect(state.accounts.get("owner")?.pendingLogin).toBeUndefined();
  expect(state.accounts.get("owner")?.loginError).toContain("identity");
  test = await prepare(undefined, "openid email");
  await expect(finishChatGPTLogin(test.callback)).rejects.toThrow(
    "plan access",
  );
  expect(state.accounts.get("owner")?.accessToken).toBeUndefined();
});
it("does not let an earlier sign-in overwrite the latest attempt or report an error for it", async () => {
  const earlier = await prepare();
  const next = await startChatGPTLogin("owner");
  const latestState = new URL(next.url).searchParams.get("state");
  await expect(finishChatGPTLogin(earlier.callback)).rejects.toThrow("changed");
  expect(state.accounts.get("owner")?.pendingLogin?.state).toBe(latestState);
  expect(state.accounts.get("owner")?.loginError).toBeUndefined();
  expect(state.accounts.get("owner")?.accessToken).toBeUndefined();
});
it("refreshes using the issued client, rotating credentials and preserved scopes", async () => {
  const fetchMock = vi.fn(async () =>
    Response.json({
      access_token: "next-access",
      refresh_token: "next-refresh",
      expires_in: 3600,
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const account = await usableChatGPTAccount("owner", {
    hostId: "host",
    enabled: true,
    clientId: "oaiapp_fixture",
    subject: "subject",
    accessToken: "old-access",
    refreshToken: "old-refresh",
    scopes: ["chatgpt.tokens.use.direct"],
    expiresAt: 0,
  });
  expect(account).toMatchObject({
    accessToken: "next-access",
    refreshToken: "next-refresh",
    scopes: ["chatgpt.tokens.use.direct"],
  });
  const [, options] = fetchMock.mock.calls[0] as unknown as [
    string,
    RequestInit,
  ];
  expect(
    new URLSearchParams(options.body as URLSearchParams).get("client_id"),
  ).toBe("oaiapp_fixture");
});
