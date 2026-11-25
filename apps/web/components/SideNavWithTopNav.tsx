"use client";

import {
  type CSSProperties,
  Suspense,
  useCallback,
  useRef,
  useState,
} from "react";
import { PanelLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import dynamic from "next/dynamic";
import { useVisibleWorkspacePathname } from "@/components/WorkspaceRetention";
import {
  SidebarInset,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar";
import { SideNav } from "@/components/SideNav";
import { SidebarTabNavigation } from "@/components/SidebarTabNavigation";
import { MessageRulesRuntime } from "@/components/MessageRulesRuntime";
import { AttentionRuntime } from "@/components/AttentionRuntime";
import { SlashCommandRuntime } from "@/components/SlashCommandRuntime";
import { SidebarRight } from "@/components/SidebarRight";
import { chatSidebarWidthCss } from "@/components/chat-sidebar-width";
import { cn } from "@/utils";

const CrispWithNoSSR = dynamic(() => import("@/components/CrispChat"));

function ContentWrapper({ children }: { children: React.ReactNode }) {
  const { state } = useSidebar();
  const pathname = useVisibleWorkspacePathname();
  const isAssistantRoute = pathname?.includes("/assistant");
  const isMailRoute = pathname?.includes("/mail");
  const isFullHeightRoute =
    pathname?.includes("/agents") ||
    pathname?.includes("/messages") ||
    pathname?.includes("/contacts") ||
    pathname?.includes("/todo") ||
    pathname?.includes("/notes");
  const isRightSidebarOpen =
    !isAssistantRoute && state.includes("chat-sidebar");

  // The padding only exists to clear the fixed MobileHeader, which neither of
  // these routes renders â€” on mail it showed up as a blank strip above the
  // screen's own sidebar and toolbar.
  const noTopPadding = isAssistantRoute || isMailRoute;

  return (
    <div
      className={cn(
        "min-w-0 flex-1 transition-[margin-right] duration-200 ease-linear",
        isRightSidebarOpen && "lg:mr-[--chat-sidebar-width]",
      )}
    >
      <SidebarInset
        className={cn(
          // clip, not hidden: hidden makes this a scroll container, which
          // stops sticky descendants from sticking to the page scroll
          "overflow-clip bg-background pt-9 max-w-full",
          noTopPadding && "pt-0",
          isFullHeightRoute && "lg:pt-0",
          (isMailRoute || isAssistantRoute || isFullHeightRoute) &&
            "h-dvh min-h-0",
        )}
      >
        {children}
      </SidebarInset>
      <Suspense>
        <CrispWithNoSSR />
      </Suspense>
    </div>
  );
}

export function SideNavWithTopNav({
  children,
  defaultOpen,
  chatSidebarWidth,
  sidebarWidth,
}: {
  children: React.ReactNode;
  defaultOpen: boolean;
  feedbackEnabled: boolean;
  chatSidebarWidth: number;
  sidebarWidth: number;
}) {
  const pathname = useVisibleWorkspacePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Dragging writes straight to the CSS variable the chat panel and the page
  // margin beside it both read, rather than re-rendering the app on every
  // pointer move.
  const frameRef = useRef<HTMLDivElement>(null);
  const setChatSidebarWidth = useCallback((width: number) => {
    frameRef.current?.style.setProperty(
      "--chat-sidebar-width",
      chatSidebarWidthCss(width),
    );
  }, []);

  if (!pathname) return null;

  const isAssistantRoute = pathname.includes("/assistant");
  // The mail screen ships its own sidebar, so this one would be a second copy.
  const isMailRoute = pathname.includes("/mail");

  // Ugly code. May change the onboarding path later so we don't need to do this.
  // Only return children for the onboarding or onboarding-brief pages: /[emailAccountId]/onboarding or /[emailAccountId]/onboarding-brief
  const segments = pathname.split("/").filter(Boolean);
  if (
    segments.length === 2 &&
    (segments[1] === "onboarding" || segments[1] === "onboarding-brief")
  )
    return children;

  return (
    <SidebarProvider
      ref={frameRef}
      className="mail-account-theme"
      style={
        {
          "--mail-hue": 0,
          "--mail-saturation": "0%",
          "--mail-sidebar-width": `${sidebarWidth}px`,
          "--chat-sidebar-width": chatSidebarWidthCss(chatSidebarWidth),
        } as CSSProperties
      }
      defaultOpen={defaultOpen ? ["left-sidebar"] : []}
      sidebarNames={["left-sidebar", "chat-sidebar"]}
      keyboardShortcutName="left-sidebar"
    >
      {/* Mail supplies its own sidebar and trigger for this shared state, so
          the global navigation and its mobile header would be duplicates. */}
      {!isMailRoute && (
        <>
          <MobileHeader onOpen={() => setMobileNavOpen(true)} />
          <SideNav
            isMobileNavOpen={mobileNavOpen}
            onMobileNavOpenChange={setMobileNavOpen}
          />
        </>
      )}
      <ContentWrapper>{children}</ContentWrapper>
      <SidebarTabNavigation />
      <MessageRulesRuntime />
      <AttentionRuntime />
      <SlashCommandRuntime />
      {!isAssistantRoute ? (
        <SidebarRight name="chat-sidebar" onResize={setChatSidebarWidth} />
      ) : null}
    </SidebarProvider>
  );
}

function MobileHeader({ onOpen }: { onOpen: () => void }) {
  return (
    <header className="pointer-events-none fixed top-0 left-0 right-0 z-50 h-9 lg:hidden">
      <div className="flex h-full items-center px-4">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Open navigation"
          onClick={onOpen}
          className="pointer-events-auto size-6"
        >
          <PanelLeft className="size-4" />
        </Button>
      </div>
    </header>
  );
}
