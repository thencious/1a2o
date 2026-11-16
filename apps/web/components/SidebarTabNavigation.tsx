"use client";

import { useEffect, useSyncExternalStore } from "react";

const initialGroups = { mail: false, tools: false };
let groups = initialGroups;
const listeners = new Set<() => void>();

export function useSidebarGroups() {
  const current = useSyncExternalStore(
    subscribe,
    () => groups,
    () => initialGroups,
  );
  return {
    groups: current,
    toggleGroup: (group: keyof typeof groups) => {
      groups = { ...groups, [group]: !groups[group] };
      for (const listener of listeners) listener();
    },
  };
}

export function SidebarTabNavigation() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey
      )
        return;
      if (event.key !== "Tab" && event.key !== "Enter") return;
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (
        target.closest(
          'input,textarea,select,[contenteditable]:not([contenteditable="false"]),.xterm,[role="dialog"],[role="menu"]',
        )
      )
        return;
      const sections = Array.from(
        document.querySelectorAll<HTMLElement>(
          "[data-section-navigation] a, [data-section-group]",
        ),
      ).filter((element) => element.getClientRects().length > 0);
      if (!sections.length) return;
      if (event.key === "Enter") {
        const group = target.closest<HTMLElement>("[data-section-group]");
        if (!group) return;
        event.preventDefault();
        event.stopPropagation();
        if (group.getAttribute("aria-expanded") !== "true") group.click();
        requestAnimationFrame(() => {
          const navigation = Array.from(
            document.querySelectorAll<HTMLElement>("[data-section-navigation]"),
          ).find(
            (element) =>
              element.getAttribute("aria-label")?.toLowerCase() ===
                group.dataset.sectionGroup &&
              element.getClientRects().length > 0,
          );
          activate(navigation?.querySelector<HTMLElement>("a"));
        });
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      let index =
        document.activeElement instanceof HTMLElement
          ? sections.indexOf(document.activeElement)
          : -1;
      if (index < 0)
        index = sections.findIndex(
          (element) =>
            element instanceof HTMLAnchorElement &&
            new URL(element.href).pathname === window.location.pathname,
        );
      const step = event.shiftKey ? -1 : 1;
      const next =
        index < 0
          ? event.shiftKey
            ? sections.length - 1
            : 0
          : (index + step + sections.length) % sections.length;
      activate(sections[next]);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);
  return null;
}

function activate(element: HTMLElement | null | undefined) {
  if (!element) return;
  element.focus({ preventScroll: true });
  element.scrollIntoView({ block: "nearest" });
  if (element instanceof HTMLAnchorElement) element.click();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
