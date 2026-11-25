import { EMAIL_ACCOUNT_HEADER } from "@/utils/config";
import { EmailProviderRateLimitError } from "@/utils/error";
import { getSWRFetchErrorMessage } from "@/providers/swr-error";
import type { UnsubscribeSenderResponse } from "@/app/api/user/senders/unsubscribe/route";
export async function requestSenderUnsubscribe(
  input: {
    emailAccountId: string;
    senderEmail: string;
    unsubscribeLink?: string | null;
  },
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher("/api/user/senders/unsubscribe", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      [EMAIL_ACCOUNT_HEADER]: input.emailAccountId,
    },
    body: JSON.stringify({
      senderEmail: input.senderEmail,
      unsubscribeLink: input.unsubscribeLink,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (response.status === 429) throw new EmailProviderRateLimitError();
  let data: UnsubscribeSenderResponse;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      "The unsubscribe server returned an invalid response. Your selection is preserved; refresh the app before retrying.",
    );
  }
  if (!response.ok) throw new Error(getSWRFetchErrorMessage(data));
  if (typeof data?.unsubscribe?.success !== "boolean")
    throw new Error(
      "The unsubscribe result could not be confirmed. Your selection is preserved.",
    );
  return data.unsubscribe;
}
