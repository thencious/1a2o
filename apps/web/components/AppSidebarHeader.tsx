"use client";

import { SidebarTrigger } from "@/components/ui/sidebar";

export function AppSidebarHeader({
  collapsed,
  hideToggle = false,
}: {
  collapsed: boolean;
  hideToggle?: boolean;
}) {
  if (hideToggle) return null;
  return (
    <div
      className={
        collapsed
          ? "flex shrink-0 justify-center pb-2"
          : "relative flex shrink-0 justify-end pt-[max(0px,calc(var(--desktop-traffic-lights-height,0px)-1rem))] pb-2"
      }
    >
      <SidebarTrigger name="left-sidebar" data-desktop-mac-titlebar-toggle />
    </div>
  );
}
