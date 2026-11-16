import { z } from "zod";

export const linkedInAccessToken = z.object({
  token: z
    .string()
    .trim()
    .min(20)
    .max(8192)
    .regex(
      /^\S+$/,
      "Paste only the access token, without spaces or a Bearer prefix.",
    ),
});
