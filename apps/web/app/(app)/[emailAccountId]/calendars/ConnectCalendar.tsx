"use client";

import { useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { useAccount } from "@/providers/EmailAccountProvider";
import { toastError } from "@/components/Toast";
import { captureException } from "@/utils/error";
import type { GetCalendarAuthUrlResponse } from "@/app/api/google/calendar/auth-url/route";
import { fetchWithAccount } from "@/utils/fetch";
import { CALENDAR_ONBOARDING_RETURN_COOKIE } from "@/utils/calendar/constants";
import { useProductAnalytics } from "@/hooks/useProductAnalytics";
import type { AppPage } from "@/utils/analytics/product";
import { redirectToSafeUrl } from "@/utils/redirect";

export function ConnectCalendar({
  analyticsPage,
  onboardingReturnPath,
  provider,
  editing = false,
  email,
}: {
  analyticsPage?: AppPage;
  onboardingReturnPath?: string;
  provider?: "google" | "microsoft";
  editing?: boolean;
  email?: string;
}) {
  const { emailAccountId } = useAccount();
  const analytics = useProductAnalytics(analyticsPage);
  const [isConnectingGoogle, setIsConnectingGoogle] = useState(false);
  const [isConnectingMicrosoft, setIsConnectingMicrosoft] = useState(false);
  const query = new URLSearchParams();
  if (editing) query.set("editing", "true");
  if (email) query.set("loginHint", email);
  const suffix = query.size ? `?${query}` : "";

  const setOnboardingReturnCookie = () => {
    if (onboardingReturnPath) {
      document.cookie = `${CALENDAR_ONBOARDING_RETURN_COOKIE}=${encodeURIComponent(onboardingReturnPath)}; path=/; max-age=180; SameSite=Lax; Secure`;
    }
  };

  const handleConnectGoogle = async () => {
    analytics.captureAction("calendar_connect_started", {
      provider: "google",
      has_onboarding_return_path: Boolean(onboardingReturnPath),
    });
    setIsConnectingGoogle(true);
    try {
      const response = await fetchWithAccount({
        url: `/api/google/calendar/auth-url${suffix}`,
        emailAccountId,
        init: { headers: { "Content-Type": "application/json" } },
      });

      if (!response.ok) {
        throw new Error("Failed to initiate Google calendar connection");
      }

      const data: GetCalendarAuthUrlResponse = await response.json();
      setOnboardingReturnCookie();
      redirectToSafeUrl(data.url, { allowExternal: true });
    } catch (error) {
      analytics.captureAction("calendar_connect_start_failed", {
        provider: "google",
      });
      captureException(error, {
        extra: { context: "Google Calendar OAuth initiation" },
      });
      toastError({
        title: "Error initiating Google calendar connection",
        description: "Please try again or contact support",
      });
      setIsConnectingGoogle(false);
    }
  };

  const handleConnectMicrosoft = async () => {
    analytics.captureAction("calendar_connect_started", {
      provider: "microsoft",
      has_onboarding_return_path: Boolean(onboardingReturnPath),
    });
    setIsConnectingMicrosoft(true);
    try {
      const response = await fetchWithAccount({
        url: `/api/outlook/calendar/auth-url${suffix}`,
        emailAccountId,
        init: { headers: { "Content-Type": "application/json" } },
      });

      if (!response.ok) {
        throw new Error("Failed to initiate Microsoft calendar connection");
      }

      const data: GetCalendarAuthUrlResponse = await response.json();
      setOnboardingReturnCookie();
      redirectToSafeUrl(data.url, { allowExternal: true });
    } catch (error) {
      analytics.captureAction("calendar_connect_start_failed", {
        provider: "microsoft",
      });
      captureException(error, {
        extra: { context: "Microsoft Calendar OAuth initiation" },
      });
      toastError({
        title: "Error initiating Microsoft calendar connection",
        description: "Please try again or contact support",
      });
      setIsConnectingMicrosoft(false);
    }
  };

  return (
    <div className="flex gap-2 flex-wrap md:flex-nowrap">
      {(!provider || provider === "google") && (
        <Button
          aria-label={
            editing
              ? `Enable editing for ${email ?? "Google Calendar"}`
              : undefined
          }
          onClick={handleConnectGoogle}
          disabled={isConnectingGoogle || isConnectingMicrosoft}
          variant="outline"
          className="flex items-center gap-2 w-full md:w-auto"
        >
          <Image
            src="/images/google.svg"
            alt="Google"
            width={16}
            height={16}
            unoptimized
          />
          {isConnectingGoogle
            ? "Connecting..."
            : editing
              ? "Enable editing"
              : "Add Google Calendar"}
        </Button>
      )}

      {(!provider || provider === "microsoft") && (
        <Button
          aria-label={
            editing
              ? `Enable editing for ${email ?? "Outlook Calendar"}`
              : undefined
          }
          onClick={handleConnectMicrosoft}
          disabled={isConnectingGoogle || isConnectingMicrosoft}
          variant="outline"
          className="flex items-center gap-2 w-full md:w-auto"
        >
          <Image
            src="/images/microsoft.svg"
            alt="Microsoft"
            width={16}
            height={16}
            unoptimized
          />
          {isConnectingMicrosoft
            ? "Connecting..."
            : editing
              ? "Enable editing"
              : "Add Outlook Calendar"}
        </Button>
      )}
    </div>
  );
}
