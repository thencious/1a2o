import "server-only";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { SafeError } from "@/utils/error";
import type { SelectModel } from "@/utils/llms/model";
import {
  chatGPTReasoningEffort,
  type chatGPTConfiguration,
} from "@/utils/actions/chatgpt.validation";
import { assertLocalChatGPTOwner, usableChatGPTAccount } from "./oauth";
import {
  readChatGPTAccount,
  updateChatGPTAccount,
  type ChatGPTAccount,
} from "./store";

const catalogSchema = z.object({
  models: z.array(
    z.object({
      slug: z.string(),
      display_name: z.string(),
      visibility: z.string(),
      default_reasoning_level: z.string().optional(),
      supported_reasoning_levels: z
        .array(
          z.object({ effort: z.string(), description: z.string().optional() }),
        )
        .default([]),
    }),
  ),
});
async function withModels(userId: string, account: ChatGPTAccount) {
  const refreshed = await usableChatGPTAccount(userId, account);
  if (
    refreshed.models?.length &&
    refreshed.models.every((model) => model.reasoningLevels !== undefined) &&
    (refreshed.catalogAt ?? 0) > Date.now() - 5 * 60_000
  )
    return refreshed;
  const response = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${refreshed.accessToken}` },
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (!response.ok)
    throw new SafeError(
      `ChatGPT model list failed (HTTP ${response.status}). Reconnect or try again later.`,
    );
  const catalog = catalogSchema.parse(await response.json());
  const models = catalog.models
    .filter((model) => model.visibility === "list")
    .map((model) => ({
      id: model.slug,
      name: model.display_name,
      defaultReasoning: model.default_reasoning_level,
      // Ultra requires client-side delegation; expose the ordinary Responses effort levels.
      reasoningLevels: model.supported_reasoning_levels
        .filter(
          (level) => chatGPTReasoningEffort.safeParse(level.effort).success,
        )
        .map((level) => ({
          effort: level.effort,
          description: level.description ?? level.effort,
        })),
    }));
  if (!models.length)
    throw new SafeError(
      "ChatGPT did not return any available models for this account.",
    );
  return {
    ...refreshed,
    models,
    model: models.some((model) => model.id === refreshed.model)
      ? refreshed.model
      : models[0].id,
    catalogAt: Date.now(),
  };
}
export async function chatGPTStatus(userId: string) {
  assertLocalChatGPTOwner(userId);
  const account = await readChatGPTAccount(userId);
  const pendingUntil =
    account?.pendingLogin && account.pendingLogin.expiresAt > Date.now()
      ? account.pendingLogin.expiresAt
      : null;
  const loginError =
    account?.loginError ??
    (account?.pendingLogin && !pendingUntil
      ? "ChatGPT sign-in timed out before 1a2o received confirmation. Please try again and complete the permissions screen."
      : null);
  if (!account?.accessToken)
    return {
      connected: false,
      enabled: false,
      email: account?.email ?? null,
      model: null,
      reasoningEffort: null,
      models: [],
      error: null,
      pendingUntil,
      loginError,
    };
  try {
    return await updateChatGPTAccount(userId, async (current) => {
      const updated = await withModels(userId, current);
      return {
        account: updated,
        result: {
          connected: true,
          enabled: updated.enabled,
          email: updated.email ?? null,
          model: updated.model ?? null,
          reasoningEffort: selectedReasoning(updated) ?? null,
          models: updated.models ?? [],
          error: null,
          pendingUntil,
          loginError,
        },
      };
    });
  } catch (error) {
    return {
      connected: true,
      enabled: account.enabled,
      email: account.email ?? null,
      model: account.model ?? null,
      reasoningEffort: selectedReasoning(account) ?? null,
      models: account.models ?? [],
      error:
        error instanceof SafeError
          ? error.message
          : "Could not load the ChatGPT connection. Please reconnect.",
      pendingUntil,
      loginError,
    };
  }
}
export async function configureChatGPT(
  userId: string,
  input: z.infer<typeof chatGPTConfiguration>,
) {
  assertLocalChatGPTOwner(userId);
  return updateChatGPTAccount(userId, async (current) => {
    if (input.mode === "openrouter")
      return {
        account: { ...current, enabled: false },
        result: { revocationConfirmed: true },
      };
    if (input.mode === "disconnect") {
      let revocationConfirmed = !current.refreshToken;
      if (current.refreshToken && current.clientId) {
        try {
          const discovery = await fetch(
            "https://auth.openai.com/.well-known/openid-configuration",
            { signal: AbortSignal.timeout(10_000) },
          ).then((response) => response.json());
          const endpoint = new URL(discovery.revocation_endpoint);
          if (endpoint.origin !== "https://auth.openai.com")
            throw new Error("Invalid revocation endpoint");
          const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              token: current.refreshToken,
              token_type_hint: "refresh_token",
              client_id: current.clientId,
            }),
            signal: AbortSignal.timeout(10_000),
          });
          revocationConfirmed = response.ok;
        } catch {
          revocationConfirmed = false;
        }
      }
      return {
        account: {
          hostId: current.hostId,
          clientId: current.clientId,
          subject: current.subject,
          email: current.email,
          enabled: false,
          scopes: [],
        },
        result: { revocationConfirmed },
      };
    }
    const updated = await withModels(userId, current);
    if (input.mode === "model") {
      if (!updated.models?.some((model) => model.id === input.model))
        throw new SafeError(
          "Choose a model available to this ChatGPT account.",
        );
      updated.model = input.model;
      updated.reasoningEffort = selectedReasoning(updated);
    } else if (input.mode === "reasoning") {
      const selected = updated.models?.find(
        (model) => model.id === updated.model,
      );
      if (
        !selected?.reasoningLevels?.some(
          (level) => level.effort === input.reasoningEffort,
        )
      )
        throw new SafeError(
          "Choose a thinking level supported by the selected model.",
        );
      updated.reasoningEffort = input.reasoningEffort;
    } else updated.enabled = true;
    return { account: updated, result: { revocationConfirmed: true } };
  });
}
export async function chatGPTModel(
  userId: string,
): Promise<SelectModel | undefined> {
  const account = await readChatGPTAccount(userId);
  if (!account?.enabled) return;
  assertLocalChatGPTOwner(userId);
  return updateChatGPTAccount<SelectModel | undefined>(
    userId,
    async (current) => {
      if (!current.enabled) return { account: current, result: undefined };
      const updated = await withModels(userId, current);
      if (!updated.model)
        throw new SafeError("Select a ChatGPT model in Chat.");
      const reasoningEffort = selectedReasoning(updated);
      const model: SelectModel = {
        provider: "chatgpt",
        modelName: updated.model,
        model: createOpenAI({
          apiKey: updated.accessToken,
          baseURL: "https://api.openai.com/v1",
        }).responses(updated.model),
        providerOptions: {
          openai: {
            store: false,
            ...(reasoningEffort ? { reasoningEffort } : {}),
          },
        },
        fallbackModels: [],
        hasUserApiKey: true,
      };
      return { account: updated, result: model };
    },
  );
}
function selectedReasoning(account: ChatGPTAccount) {
  const model = account.models?.find((item) => item.id === account.model);
  const levels = model?.reasoningLevels ?? [];
  if (levels.some((level) => level.effort === account.reasoningEffort))
    return account.reasoningEffort;
  if (levels.some((level) => level.effort === model?.defaultReasoning))
    return model?.defaultReasoning;
  return levels[0]?.effort;
}
