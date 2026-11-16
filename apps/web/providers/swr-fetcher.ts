import { captureException } from "@/utils/error";
import {
  EMAIL_ACCOUNT_HEADER,
  MICROSOFT_AUTH_EXPIRED_ERROR_CODE,
  NO_REFRESH_TOKEN_ERROR_CODE,
} from "@/utils/config";
import {
  getSWRFetchErrorMessage,
  normalizeSWRFetchErrorData,
} from "./swr-error";

// https://swr.vercel.app/docs/error-handling#status-code-and-error-object
export const swrFetcher = async (
  url: string,
  init?: RequestInit | undefined,
  emailAccountId?: string | null,
) => {
  const headers = new Headers(init?.headers);

  if (emailAccountId) {
    headers.set(EMAIL_ACCOUNT_HEADER, emailAccountId);
  }

  const newInit = { ...init, headers };

  let res: Response;
  try {
    res = await fetch(url, newInit);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    // Browsers reject with an opaque "Failed to fetch" / "Load failed".
    const message =
      "Couldn't connect to Inbox Zero. Check your internet connection and try again.";
    const networkError: Error & { info?: Record<string, unknown> } = new Error(
      message,
      { cause: error },
    );
    // Error screens read the message from `info`, like a server error.
    networkError.info = { error: message };
    throw networkError;
  }

  if (!res.ok) {
    // Try to parse JSON, but handle cases where response isn't JSON (e.g. HMR 404s)
    let errorData: Record<string, unknown> = {};
    try {
      const payload: unknown = await res.json();
      errorData = normalizeSWRFetchErrorData(payload);
    } catch {
      // Response wasn't JSON - common during dev HMR, unexpected in production
      if (process.env.NODE_ENV !== "development") {
        console.error("Failed to parse error response as JSON", {
          url,
          status: res.status,
          statusText: res.statusText,
        });
      }
    }

    const isProviderAuthError =
      errorData.errorCode === NO_REFRESH_TOKEN_ERROR_CODE ||
      errorData.errorCode === MICROSOFT_AUTH_EXPIRED_ERROR_CODE;

    const errorMessage = getSWRFetchErrorMessage(errorData);
    const error: Error & {
      info?: Record<string, unknown>;
      status?: number;
      errorCode?: string;
      retryable?: boolean;
    } = new Error(errorMessage);

    // Attach extra info to the error object.
    error.info = errorData;
    error.status = res.status;
    if (typeof errorData.errorCode === "string")
      error.errorCode = errorData.errorCode;
    // Background requests must not navigate or repeatedly retry a disconnected
    // mailbox. The account banner provides the explicit reconnect action.
    if (isProviderAuthError) error.retryable = false;

    const isKnownError = errorData.isKnownError || isProviderAuthError;

    if (!isKnownError) {
      captureException(error, {
        extra: {
          url,
          status: res.status,
          statusText: res.statusText,
          responseBody: error.info,
          extraMessage: "SWR fetch error",
        },
      });
    }

    throw error;
  }

  return res.json();
};
