import { z } from "zod";
export const agentCommand = z.object({
  op: z.enum([
    "add",
    "configure",
    "new",
    "remove",
    "connect",
    "restart",
    "send",
    "timer",
    "pause",
    "cancel",
    "editing",
    "edit_schedule",
    "cancel_all",
  ]),
  id: z.string().uuid().optional(),
  taskId: z.uuid().optional(),
  append: z.boolean().optional(),
  delay: z.string().max(30).optional(),
  active: z.boolean().optional(),
  settings: z
    .object({
      chat_id: z.string().max(200).optional(),
      chat_title: z.string().max(4096).optional(),
      cwd: z.string().max(4096).optional(),
      model: z.string().max(200).optional(),
      effort: z.string().max(30).optional(),
      message: z.string().max(200_000).optional(),
      cwd_manual: z.boolean().optional(),
    })
    .optional(),
});
