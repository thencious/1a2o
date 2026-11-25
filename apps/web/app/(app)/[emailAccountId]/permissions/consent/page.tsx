"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageHeading, TypographyP } from "@/components/Typography";
import { useAccount } from "@/providers/EmailAccountProvider";
import { toastError } from "@/components/Toast";
import { getAccountLinkingUrl } from "@/utils/account-linking";
import { BRAND_NAME } from "@/utils/branding";
import { getSafeRedirectUrl } from "@/utils/redirect";

export default function PermissionsConsentPage() {
  const {
    emailAccountId,
    userEmail,
    provider,
    isLoading: accountLoading,
  } = useAccount();
  const { emailAccountId: routeAccountId } = useParams<{
    emailAccountId: string;
  }>();
  const startedFor = useRef<string>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const isMicrosoft = provider === "microsoft";
  const canReconnect =
    Boolean(emailAccountId) &&
    emailAccountId === routeAccountId &&
    (provider === "google" || isMicrosoft);

  const handleReconnect = useCallback(async () => {
    if (!canReconnect || (provider !== "google" && provider !== "microsoft"))
      return;
    const reconnectPath = window.location.pathname;
    setIsReconnecting(true);

    try {
      const url = await getAccountLinkingUrl(provider, {
        reconnectEmailAccountId: emailAccountId,
      });
      if (window.location.pathname === reconnectPath)
        window.location.replace(
          getSafeRedirectUrl(url, { allowExternal: true }),
        );
    } catch (error) {
      toastError({
        title: "Error initiating reconnection",
        description:
          error instanceof Error
            ? error.message
            : "Please try again or contact support",
      });
      setIsReconnecting(false);
    }
  }, [canReconnect, emailAccountId, provider]);

  useEffect(() => {
    if (
      accountLoading ||
      !canReconnect ||
      startedFor.current === emailAccountId
    )
      return;
    startedFor.current = emailAccountId;
    handleReconnect();
  }, [accountLoading, canReconnect, emailAccountId, handleReconnect]);

  return (
    <div className="flex flex-col items-center justify-center sm:p-20 md:p-32">
      <PageHeading className="text-center">Reconnect account</PageHeading>

      <TypographyP className="mx-auto mt-4 max-w-prose text-center">
        {userEmail
          ? `Approve access for ${userEmail}`
          : "Approve access for this account"}{" "}
        to sync mail and calendars together.
      </TypographyP>

      {isMicrosoft && (
        <TypographyP className="mx-auto mt-3 max-w-prose text-center text-muted-foreground">
          If your organization restricts user consent, ask your Microsoft 365
          admin to approve {BRAND_NAME} and then reconnect your account.
        </TypographyP>
      )}
      <Button
        className="mt-4"
        onClick={handleReconnect}
        loading={isReconnecting}
        disabled={isReconnecting || accountLoading || !canReconnect}
      >
        Reconnect account
      </Button>

      <p className="mt-8 text-center text-muted-foreground">
        Having trouble?{" "}
        <Link href="/logout" className="underline hover:text-primary">
          Sign out
        </Link>{" "}
        and sign back in again.
      </p>

      <div className="mt-8">
        <Image
          src="/images/illustrations/falling.svg"
          alt=""
          width={400}
          height={400}
          unoptimized
          className="dark:brightness-90 dark:invert"
        />
      </div>
    </div>
  );
}
