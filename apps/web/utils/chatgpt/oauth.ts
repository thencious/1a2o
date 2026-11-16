import "server-only";
import { randomBytes, createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";
import { env } from "@/env";
import { SafeError } from "@/utils/error";
import {
  consumeChatGPTAttempt,
  saveChatGPTAttempt,
  updateChatGPTAccount,
  type ChatGPTAccount,
  type ChatGPTAttempt,
} from "./store";

const issuer = "https://auth.openai.com";
const resource = "https://api.openai.com/v1";
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().optional(),
  id_token: z.string().optional(),
  expires_in: z.number().positive(),
  scope: z.string().optional(),
});
export function assertLocalChatGPTOwner(userId: string) {
  const owner =
    process.env.LOCAL_BEEPER_OWNER_ID || process.env.LOCAL_AGENTS_OWNER_ID;
  const base = new URL(env.NEXT_PUBLIC_BASE_URL);
  if (
    !owner ||
    owner !== userId ||
    base.protocol !== "http:" ||
    !["localhost", "127.0.0.1"].includes(base.hostname)
  )
    throw new SafeError(
      "ChatGPT sign-in is available to the owner of this local installation.",
    );
}
export async function startChatGPTLogin(userId: string) {
  assertLocalChatGPTOwner(userId);
  return updateChatGPTAccount(userId, async (account) => {
    const state = randomBytes(32).toString("base64url"),
      nonce = randomBytes(32).toString("base64url"),
      verifier = randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + 10 * 60_000;
    const callback = new URL(env.NEXT_PUBLIC_BASE_URL);
    callback.hostname = "127.0.0.1";
    callback.pathname = "/auth/callback";
    callback.search = "";
    callback.hash = "";
    await saveChatGPTAttempt({
      userId,
      state,
      nonce,
      verifier,
      redirectUri: callback.href,
      expiresAt,
      clientId: account.clientId,
      subject: account.subject,
    });
    const url = new URL(`${issuer}/api/accounts/authorize`);
    url.search = new URLSearchParams({
      client_id: account.clientId ?? "dynamic_agent_client",
      ext_agent_host_id: account.hostId,
      response_type: "code",
      redirect_uri: callback.href,
      scope:
        "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
      resource,
      state,
      nonce,
      code_challenge_method: "S256",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      ...(account.clientId ? {} : { agent_name_hint: "1a2o" }),
    }).toString();
    return {
      account: {
        ...account,
        pendingLogin: { state, expiresAt },
        loginError: undefined,
      },
      result: { url: url.href },
    };
  });
}
export async function finishChatGPTLogin(params: URLSearchParams) {
  const attempt = await consumeChatGPTAttempt(params.get("state") ?? "");
  assertLocalChatGPTOwner(attempt.userId);
  try {
    await completeChatGPTLogin(params, attempt);
  } catch (error) {
    await updateChatGPTAccount(attempt.userId, async (account) => ({
      account:
        account.pendingLogin?.state === attempt.state
          ? {
              ...account,
              pendingLogin: undefined,
              loginError:
                error instanceof SafeError
                  ? error.message
                  : "ChatGPT sign-in could not be completed. Please try again.",
            }
          : account,
      result: undefined,
    }));
    throw error;
  }
}
async function completeChatGPTLogin(
  params: URLSearchParams,
  attempt: ChatGPTAttempt,
) {
  if (params.has("error"))
    throw new SafeError(
      "ChatGPT sign-in was declined. You can retry from Chat.",
    );
  const clientId = params.get("client_id") ?? attempt.clientId,
    code = params.get("code");
  if (
    !code ||
    !clientId ||
    clientId === "dynamic_agent_client" ||
    (attempt.clientId && clientId !== attempt.clientId)
  )
    throw new SafeError(
      "ChatGPT registration was incomplete. Please try again.",
    );
  const tokens = await exchangeTokens({
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    code_verifier: attempt.verifier,
    redirect_uri: attempt.redirectUri,
  });
  if (!tokens.id_token)
    throw new SafeError("ChatGPT did not provide a verified identity.");
  const { payload } = await jwtVerify(tokens.id_token, jwks, {
    issuer,
    audience: clientId,
    requiredClaims: ["sub", "exp", "iat"],
    clockTolerance: 5,
  });
  if (
    payload.nonce !== attempt.nonce ||
    !payload.sub ||
    (attempt.subject && attempt.subject !== payload.sub)
  )
    throw new SafeError(
      "ChatGPT sign-in identity did not match. Existing credentials were kept.",
    );
  const scopes = (tokens.scope ?? "").split(/\s+/);
  if (!scopes.includes("chatgpt.tokens.use.direct"))
    throw new SafeError(
      "ChatGPT plan access was not granted. Please reconnect and enable plan usage.",
    );
  await updateChatGPTAccount(attempt.userId, async (account) => {
    if (
      account.clientId !== attempt.clientId ||
      account.subject !== attempt.subject ||
      (account.pendingLogin && account.pendingLogin.state !== attempt.state)
    )
      throw new SafeError(
        "The selected ChatGPT account changed. Please try signing in again.",
      );
    return {
      account: {
        ...account,
        clientId,
        subject: payload.sub,
        email: typeof payload.email === "string" ? payload.email : undefined,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        idToken: tokens.id_token,
        scopes,
        expiresAt: Date.now() + tokens.expires_in * 1000,
        enabled: true,
        models: undefined,
        catalogAt: undefined,
        pendingLogin: undefined,
        loginError: undefined,
      },
      result: undefined,
    };
  });
}
export async function usableChatGPTAccount(
  userId: string,
  account: ChatGPTAccount,
) {
  assertLocalChatGPTOwner(userId);
  if (
    !account.accessToken ||
    !account.scopes.includes("chatgpt.tokens.use.direct")
  )
    throw new SafeError("Continue with ChatGPT in Chat to enable plan access.");
  if ((account.expiresAt ?? 0) > Date.now() + 60_000) return account;
  if (!account.refreshToken || !account.clientId)
    throw new SafeError(
      "Your ChatGPT session expired. Please reconnect in Chat.",
    );
  const tokens = await exchangeTokens({
    grant_type: "refresh_token",
    client_id: account.clientId,
    refresh_token: account.refreshToken,
  });
  if (tokens.id_token) {
    const { payload } = await jwtVerify(tokens.id_token, jwks, {
      issuer,
      audience: account.clientId,
      requiredClaims: ["sub", "exp", "iat"],
      clockTolerance: 5,
    });
    if (payload.sub !== account.subject)
      throw new SafeError(
        "ChatGPT returned a different identity. Reconnect in Chat.",
      );
  }
  const scopes =
    tokens.scope === undefined ? account.scopes : tokens.scope.split(/\s+/);
  if (!scopes.includes("chatgpt.tokens.use.direct"))
    throw new SafeError(
      "ChatGPT plan permission was removed. Please reconnect in Chat.",
    );
  return {
    ...account,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? account.refreshToken,
    idToken: tokens.id_token ?? account.idToken,
    scopes,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  };
}
export async function exchangeTokens(params: Record<string, string>) {
  const response = await fetch(`${issuer}/api/accounts/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, resource }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok)
    throw new SafeError(
      `ChatGPT authentication failed (HTTP ${response.status}). Please reconnect in Chat.`,
    );
  return tokenSchema.parse(await response.json());
}
