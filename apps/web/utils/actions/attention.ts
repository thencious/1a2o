"use server";
import { z } from "zod";
import { actionClientUser } from "./safe-action";
import { attentionTabs } from "@/utils/attention/types";
import { updateAttention, attentionOwner } from "@/utils/attention/store";
import { clearAttentionTab, reportMessageView } from "@/utils/attention/policy";
import { acknowledgeDesktopActivation } from "@/utils/attention/desktop-activation.mjs";
import { localWorkspaceRoot } from "@/utils/local-workspace";
import { SafeError } from "@/utils/error";
export const reportMessageViewAction = actionClientUser
  .metadata({ name: "reportMessageView" })
  .inputSchema(
    z.object({
      viewId: z.uuid(),
      chatId: z.string().min(1).max(2048),
      active: z.boolean(),
      sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    }),
  )
  .action(async ({ ctx: { userId }, parsedInput }) => {
    if (userId !== attentionOwner()) return { saved: false };
    await updateAttention(userId, (state) =>
      reportMessageView(state, parsedInput),
    );
    return { saved: true };
  });

export const acknowledgeDesktopActivationAction = actionClientUser
  .metadata({ name: "acknowledgeDesktopActivation" })
  .inputSchema(z.object({ id: z.uuid() }))
  .action(async ({ ctx: { userId }, parsedInput }) => {
    if (userId !== attentionOwner())
      throw new SafeError(
        "App activations are available only to this installation’s owner.",
      );
    return {
      claimed: acknowledgeDesktopActivation(
        localWorkspaceRoot(),
        parsedInput.id,
      ),
    };
  });

export const clearTabAttentionAction = actionClientUser
  .metadata({ name: "clearTabAttention" })
  .inputSchema(
    z.object({
      tab: z.enum(attentionTabs),
      through: z.number().finite().nonnegative(),
    }),
  )
  .action(async ({ ctx: { userId }, parsedInput }) =>
    updateAttention(userId, (state) => {
      clearAttentionTab(state, parsedInput.tab, parsedInput.through);
      return { saved: true };
    }),
  );
