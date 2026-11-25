import { expect, it, vi } from "vitest";
import { requestSenderUnsubscribe } from "./client-unsubscribe";
import { EmailProviderRateLimitError } from "@/utils/error";
it("posts the sender and original recipient link to a stable endpoint with the correct mailbox", async () => {
  const fetcher = vi.fn(async () =>
    Response.json({ unsubscribe: { success: true, method: "post" } }),
  );
  const result = await requestSenderUnsubscribe(
    {
      emailAccountId: "mailbox",
      senderEmail: "sender@example.com",
      unsubscribeLink: "https://example.com/unsub?recipient=mailbox",
    },
    fetcher,
  );
  expect(result.success).toBe(true);
  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("/api/user/senders/unsubscribe");
  expect((init.headers as Record<string, string>)["X-Email-Account-ID"]).toBe(
    "mailbox",
  );
  expect(JSON.parse(init.body as string).unsubscribeLink).toContain(
    "recipient=mailbox",
  );
});
it("keeps website rejection details and never converts them into success", async () => {
  expect(
    await requestSenderUnsubscribe(
      { emailAccountId: "mailbox", senderEmail: "sender@example.com" },
      async () =>
        Response.json({
          unsubscribe: {
            success: false,
            statusCode: 403,
            reason: "request_rejected",
          },
        }),
    ),
  ).toMatchObject({ success: false, statusCode: 403 });
});
it("surfaces authentication and rate-limit failures instead of silently counting generic failures", async () => {
  const input = {
    emailAccountId: "mailbox",
    senderEmail: "sender@example.com",
  };
  await expect(
    requestSenderUnsubscribe(input, async () =>
      Response.json({ error: "Reconnect this mailbox" }, { status: 401 }),
    ),
  ).rejects.toThrow("Reconnect this mailbox");
  await expect(
    requestSenderUnsubscribe(input, async () =>
      Response.json({ error: "Limited" }, { status: 429 }),
    ),
  ).rejects.toBeInstanceOf(EmailProviderRateLimitError);
  await expect(
    requestSenderUnsubscribe(input, async () => Response.json({})),
  ).rejects.toThrow("could not be confirmed");
});
