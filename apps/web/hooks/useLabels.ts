import { useEffect, useMemo, useRef } from "react";
import useSWR from "swr";
import type { LabelsResponse } from "@/app/api/labels/route";
import type { EmailLabel } from "@/providers/email-label-types";
import { useAccount } from "@/providers/EmailAccountProvider";
import { useAccounts } from "@/hooks/useAccounts";
import { compareLabelsByName } from "@/utils/label/compare-labels";

export type UserLabel = {
  id: string;
  name: string;
  type: "user";
  labelListVisibility?: string;
  messageListVisibility?: string;
  color?: {
    textColor?: string | null;
    backgroundColor?: string | null;
  };
};

export type OutlookLabel = {
  id: string;
  name: string;
  type: "user";
  color?: string;
};

export type GenericLabel = UserLabel | OutlookLabel;

function isHidden(label: EmailLabel): boolean {
  return label.labelListVisibility === "labelHide";
}

function useLabelsResponse(explicitEmailAccountId?: string) {
  const {
    emailAccount,
    isLoading: isLoadingEmailAccount,
    providerRateLimit,
  } = useAccount();
  const useContextAccount =
    !explicitEmailAccountId || explicitEmailAccountId === emailAccount?.id;
  const { data: accounts, isLoading: accountsLoading } = useAccounts(
    !useContextAccount,
  );
  const targetAccount = useContextAccount
    ? emailAccount
    : accounts?.emailAccounts.find(
        (account) => account.id === explicitEmailAccountId,
      );
  const targetIsLoading = useContextAccount
    ? isLoadingEmailAccount
    : accountsLoading;
  const targetRateLimit = useContextAccount
    ? providerRateLimit
    : targetAccount?.providerRateLimit;
  const paused = Boolean(
    targetIsLoading ||
      !targetAccount ||
      targetAccount.account?.disconnectedAt ||
      targetRateLimit,
  );
  const key = targetAccount
    ? explicitEmailAccountId
      ? ["/api/labels", explicitEmailAccountId]
      : "/api/labels"
    : null;
  const swr = useSWR<LabelsResponse>(key, {
    shouldRetryOnError: false,
    // Keep the account's cached labels visible while preventing all revalidation.
    isPaused: () => paused,
  });

  const previous = useRef({ paused, accountId: targetAccount?.id });
  useEffect(() => {
    const wasPaused = previous.current.paused;
    const sameAccount = previous.current.accountId === targetAccount?.id;
    previous.current = { paused, accountId: targetAccount?.id };
    if (wasPaused && !paused && sameAccount) swr.mutate();
  }, [paused, targetAccount?.id, swr.mutate]);

  return {
    ...swr,
    isLoading: Boolean(targetIsLoading || (!paused && swr.isLoading)),
  };
}

export function useAllLabels() {
  const { data, isLoading, error, mutate } = useLabelsResponse();

  const userLabels = useMemo(() => {
    if (!data?.labels) return [];

    return data.labels
      .filter((label) => label.type === "user")
      .sort(compareLabelsByName);
  }, [data?.labels]);

  return {
    userLabels,
    data,
    isLoading,
    error,
    mutate,
  };
}

export function useLabels(emailAccountId?: string) {
  const { data, isLoading, error, mutate } = useLabelsResponse(emailAccountId);

  const userLabels: EmailLabel[] = useMemo(() => {
    if (!data?.labels) return [];

    return data.labels
      .filter((label) => label.type === "user")
      .map((label) => ({
        id: label.id || "",
        name: label.name || "",
        type: label.type || null,
        color: label.color,
        labelListVisibility: label.labelListVisibility,
        messageListVisibility: label.messageListVisibility,
      }))
      .sort(compareLabelsByName);
  }, [data?.labels]);

  return {
    userLabels,
    isLoading,
    error,
    mutate,
  };
}

export function useSplitLabels() {
  const { userLabels, isLoading, error, mutate } = useLabels();

  const { visibleLabels, hiddenLabels } = useMemo(() => {
    // Split labels into visible and hidden categories
    const visible: EmailLabel[] = [];
    const hidden: EmailLabel[] = [];

    userLabels.forEach((label) => {
      if (isHidden(label)) {
        hidden.push(label);
      } else {
        visible.push(label);
      }
    });

    return {
      visibleLabels: visible,
      hiddenLabels: hidden,
    };
  }, [userLabels]);

  return {
    visibleLabels,
    hiddenLabels,
    isLoading,
    error,
    mutate,
  };
}
