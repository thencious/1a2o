"use client";

import { useEffect } from "react";

export function MessageRulesRuntime() {
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let retry = true;
      try {
        if (!window.location.pathname.endsWith("/messages")) {
          const options = {
            cache: "no-store" as const,
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(15_000),
            ]),
          };
          const response = await fetch("/api/user/messages/status", options);
          if (response.status === 403) retry = false;
          else if (response.ok && (await response.json()).running)
            await fetch("/api/user/messages/conversations", options);
        }
      } catch {
        // Beeper or the local server can be unavailable during startup.
      } finally {
        if (!controller.signal.aborted && retry)
          timer = setTimeout(poll, 15_000);
      }
    };
    poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, []);
  return null;
}
