import { finishChatGPTLogin } from "@/utils/chatgpt/oauth";
import { SafeError } from "@/utils/error";
export async function GET(request: Request) {
  const url = new URL(request.url);
  // NextRequest normalizes IPv4 loopback addresses to localhost internally.
  // The token exchange still uses the exact 127.0.0.1 redirect saved with PKCE.
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname)
  )
    return new Response("Use the original local sign-in callback.", {
      status: 400,
      headers: {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  try {
    await finishChatGPTLogin(url.searchParams);
    return new Response(
      "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'><title>1a2o — Connected</title><body style='background:#222;color:#ddd;font:16px system-ui;padding:3rem'><h1>Connected to ChatGPT</h1><p>Return to 1a2o. You can close this window.</p></body>",
      {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
          "Content-Security-Policy":
            "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
        },
      },
    );
  } catch (error) {
    const message =
      error instanceof SafeError
        ? error.message
        : "Sign-in could not be completed. Return to Chat in 1a2o and try again.";
    return new Response(message, {
      status: 400,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  }
}
