import { z } from "zod";
export const prepareMessageInvite = z.object({
  chatId: z.string().min(1).max(2048),
  timezone: z
    .string()
    .max(120)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, "Choose a valid timezone."),
});
