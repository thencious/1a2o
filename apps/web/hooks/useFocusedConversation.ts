"use client";
import { useEffect, useRef, useState, type RefObject } from "react";
import { mutate } from "swr";
import { reportMessageViewAction } from "@/utils/actions/attention";
import { readBeeperChatAction } from "@/utils/actions/beeper";

export function useFocusedConversation(
  chatId: string,
  latestIncoming: string | undefined,
  element: RefObject<HTMLElement | null>,
) {
  const [viewId] = useState(() => crypto.randomUUID());
  const sequence = useRef(0);
  useEffect(() => {
    const report = (active = focused(element.current)) => {
      reportMessageViewAction({
        viewId,
        chatId,
        active,
        sequence: ++sequence.current,
      }).catch(() => {});
    };
    const refresh = () => report();
    const leave = () => report(false);
    report();
    const timer = setInterval(() => {
      if (focused(element.current)) report(true);
    }, 4000);
    window.addEventListener("focus", refresh);
    window.addEventListener("blur", leave);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("pagehide", leave);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("blur", leave);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [chatId, viewId, element]);
  useEffect(() => {
    const read = () => {
      if (!latestIncoming || !focused(element.current)) return;
      readBeeperChatAction({ chatId })
        .then((result) => {
          if (result?.data) mutate("/api/user/attention").catch(() => {});
        })
        .catch(() => {});
    };
    read();
    window.addEventListener("focus", read);
    document.addEventListener("visibilitychange", read);
    return () => {
      window.removeEventListener("focus", read);
      document.removeEventListener("visibilitychange", read);
    };
  }, [chatId, latestIncoming, element]);
}
function focused(element: HTMLElement | null) {
  return Boolean(
    element?.getClientRects().length &&
      element
        .closest("[data-workspace-active]")
        ?.getAttribute("data-workspace-active") !== "false" &&
      document.visibilityState === "visible" &&
      document.hasFocus(),
  );
}
