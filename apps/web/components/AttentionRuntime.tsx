"use client";
import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAttention } from "@/hooks/useAttention";
import {
  clearTabAttentionAction,
  acknowledgeDesktopActivationAction,
} from "@/utils/actions/attention";
import { attentionTabs, type AttentionTab } from "@/utils/attention/types";

export function AttentionRuntime() {
  const { data, mutate } = useAttention();
  const pathname = usePathname();
  const router = useRouter();
  const claiming = useRef<string | undefined>(undefined);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible" && document.hasFocus())
        mutate().catch(() => {});
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [mutate]);
  useEffect(() => {
    const activation = data?.activation;
    if (!data?.enabled || !activation) return;
    const navigate = async () => {
      if (
        document.visibilityState !== "visible" ||
        !document.hasFocus() ||
        claiming.current
      )
        return;
      claiming.current = activation.id;
      try {
        const result = await acknowledgeDesktopActivationAction({
          id: activation.id,
        });
        if (result?.data?.claimed) {
          const current = window.location.pathname + window.location.search;
          if (current !== activation.path) router.push(activation.path);
          await mutate();
        }
      } catch {
        /* Keep the request available until the focused window can claim it. */
      } finally {
        claiming.current = undefined;
      }
    };
    navigate();
    window.addEventListener("focus", navigate);
    document.addEventListener("visibilitychange", navigate);
    return () => {
      window.removeEventListener("focus", navigate);
      document.removeEventListener("visibilitychange", navigate);
    };
  }, [data, router, mutate]);
  const section = pathname.split("/")[2];
  const tab = attentionTabs.includes(section as AttentionTab)
    ? (section as AttentionTab)
    : null;
  useEffect(() => {
    if (!data?.enabled || !tab || !data.counts[tab]) return;
    let pending = false;
    const clear = async () => {
      if (
        pending ||
        document.visibilityState !== "visible" ||
        !document.hasFocus()
      )
        return;
      pending = true;
      try {
        const result = await clearTabAttentionAction({
          tab,
          through: data.through,
        });
        if (result?.data) await mutate();
      } catch {
        /* Keep the dot until the acknowledgement can be saved. */
      } finally {
        pending = false;
      }
    };
    clear();
    window.addEventListener("focus", clear);
    document.addEventListener("visibilitychange", clear);
    return () => {
      window.removeEventListener("focus", clear);
      document.removeEventListener("visibilitychange", clear);
    };
  }, [data, tab, mutate]);
  return null;
}
