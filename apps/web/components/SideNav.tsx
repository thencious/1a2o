"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useVisibleWorkspacePathname } from "@/components/WorkspaceRetention";
import { useEffect, useState } from "react";
import { MailShellSidebar } from "@/app/(app)/[emailAccountId]/mail/MailShellSidebar";
import { MailAccountThemeProvider } from "@/providers/MailAccountThemeProvider";
import { useAccount } from "@/providers/EmailAccountProvider";
import { getInboxZeroDesktopApp } from "@/utils/desktop-app";

export function SideNav({
  isMobileNavOpen,
  onMobileNavOpenChange,
}: {
  isMobileNavOpen: boolean;
  onMobileNavOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const pathname = useVisibleWorkspacePathname();
  const searchParams = useSearchParams();
  const { emailAccountId } = useAccount();
  const [isDesktopApp, setIsDesktopApp] = useState(false);
  useEffect(() => setIsDesktopApp(Boolean(getInboxZeroDesktopApp())), []);
  const isAllAccounts = searchParams.get("accountScope") !== "single";
  const close = () => onMobileNavOpenChange(false);
  const selectAccount = (accountId: string) => {
    const suffix = pathname.startsWith(`/${emailAccountId}/`)
      ? pathname.slice(emailAccountId.length + 1)
      : "/mail";
    const params = new URLSearchParams(searchParams);
    params.set("accountScope", "single");
    router.push(`/${encodeURIComponent(accountId)}${suffix}?${params}`);
  };
  const selectAll = () => {
    const params = new URLSearchParams(searchParams);
    params.set("accountScope", "all");
    router.push(`${pathname}?${params}`);
  };
  return (
    <MailAccountThemeProvider>
      <MailShellSidebar
        activeType={null}
        activeLabelId={null}
        activeFolderId={null}
        isAllAccounts={isAllAccounts}
        isDesktopApp={isDesktopApp}
        onSelectAccount={selectAccount}
        onSelectAllAccounts={selectAll}
        onMailboxItemDeleted={async () => undefined}
        onNavigate={close}
        isMobileNavOpen={isMobileNavOpen}
        onMobileNavOpenChange={onMobileNavOpenChange}
      />
    </MailAccountThemeProvider>
  );
}
