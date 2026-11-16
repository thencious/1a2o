import { z } from "zod";

export const combineContactsSchema = z.object({
  contactKeys: z.array(z.string().min(1).max(32_768)).min(2).max(20),
});
