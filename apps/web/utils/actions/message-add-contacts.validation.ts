import { z } from "zod";
export const addMessageContacts = z.object({
  chatId: z.string().min(1).max(2048),
});
