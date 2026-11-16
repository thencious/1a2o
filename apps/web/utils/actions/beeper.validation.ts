import { z } from "zod";
export const beeperToken = z.object({
  token: z.string().trim().min(8).max(8192),
});
export const beeperChat = z.object({ chatId: z.string().min(1).max(2048) });
export const beeperMessage = beeperChat.extend({
  messageId: z.string().min(1).max(2048),
});
export const beeperEdit = beeperMessage.extend({
  text: z
    .string()
    .max(20_000)
    .refine((value) => Boolean(value.trim()), "Enter a message."),
  revision: z
    .string()
    .regex(/^[a-f0-9]{64}$/, "Reopen this message before editing."),
});
export const beeperReaction = beeperMessage.extend({
  reactionKey: z.string().trim().min(1).max(256),
  remove: z.boolean(),
  requestId: z.string().uuid(),
});
export const beeperGroup = beeperChat.extend({ include: z.boolean() });
export const beeperMention = z.object({
  userId: z.string().min(1).max(2048),
  label: z.string().min(1).max(250),
  start: z.number().int().min(0).max(20_000),
  end: z.number().int().min(1).max(20_000),
});
export const beeperSend = beeperChat
  .extend({
    requestId: z.string().uuid(),
    text: z.string().max(20_000),
    replyToMessageId: z.string().min(1).max(2048).optional(),
    mentions: z.array(beeperMention).max(100).optional(),
    attachment: z
      .object({
        name: z.string().min(1).max(255),
        mime: z.string().max(200),
        content: z.string().max(24_000_000),
      })
      .optional(),
  })
  .refine(
    (value) => value.text.trim() || value.attachment,
    "Enter a message or attach a file.",
  );

export const beeperRecoveryPreferences = z
  .object({
    autoStart: z.boolean().optional(),
    autoVerify: z.boolean().optional(),
    recoveryKey: z
      .string()
      .trim()
      .min(16)
      .max(512)
      .regex(/^[A-Za-z0-9\s-]+$/, "Enter the recovery key, rather than a link.")
      .optional(),
    clearKey: z.boolean().optional(),
  })
  .refine(
    (value) => !(value.clearKey && value.recoveryKey),
    "Save or forget the key in separate steps.",
  );
