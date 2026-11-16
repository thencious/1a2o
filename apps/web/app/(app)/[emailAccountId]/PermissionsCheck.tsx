"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { useSWRConfig } from "swr";
import { checkPermissionsAction } from "@/utils/actions/permissions";
import { useAccount } from "@/providers/EmailAccountProvider";
import { useAccounts } from "@/hooks/useAccounts";
import { useOrgAccess } from "@/hooks/useOrgAccess";
import { AppAlertBanner } from "@/app/(app)/AppAlertBanner";
import { Button } from "@/components/ui/button";
import { prefixPath } from "@/utils/path";

const permissionsChecked: Record<string, true | symbol | undefined> = {};
const missingPermissionAccounts = new Set<string>();
const permissionListeners = new Set<() => void>();

export function PermissionsCheck() {
  const { emailAccountId, emailAccount } = useAccount();
  const { isAccountOwner } = useOrgAccess();
  const { mutate: refreshAccounts } = useAccounts();
  const { mutate } = useSWRConfig();
  const disconnectedAt = emailAccount?.account.disconnectedAt;
  const missingPermissions = useSyncExternalStore(
    subscribePermissions,
    () => missingPermissionAccounts.has(emailAccountId),
    () => false,
  );

  useEffect(() => {
    if (!isAccountOwner || !emailAccountId) return;
    if (disconnectedAt) {
      delete permissionsChecked[emailAccountId];
      setMissingPermissions(emailAccountId, false);
      return;
    }
    if (permissionsChecked[emailAccountId]) return;
    const check = Symbol(emailAccountId);
    permissionsChecked[emailAccountId] = check;
    let active = true;

    checkPermissionsAction(emailAccountId)
      .then(async (result) => {
        if (!active || permissionsChecked[emailAccountId] !== check) return;
        permissionsChecked[emailAccountId] = true;
        if (
          result?.data &&
          "missingPermissions" in result.data &&
          result.data.missingPermissions === true
        ) {
          setMissingPermissions(emailAccountId, true);
        } else if (
          result?.data?.hasAllPermissions === true &&
          result.data.hasRefreshToken === true
        ) {
          setMissingPermissions(emailAccountId, false);
        }
        if (
          result?.data?.hasAllPermissions === false ||
          result?.data?.hasRefreshToken === false ||
          result?.serverError
        ) {
          // A failed probe can be transient. Refresh the recorded account state;
          // reconnect stays an explicit action in the shared warning banner.
          await Promise.allSettled([
            refreshAccounts(),
            mutate("/api/user/error-messages"),
          ]);
        }
      })
      .catch(() => {
        if (permissionsChecked[emailAccountId] === check)
          delete permissionsChecked[emailAccountId];
      });

    return () => {
      active = false;
      if (permissionsChecked[emailAccountId] === check)
        delete permissionsChecked[emailAccountId];
    };
  }, [emailAccountId, isAccountOwner, disconnectedAt, refreshAccounts, mutate]);

  if (!isAccountOwner || disconnectedAt || !missingPermissions) return null;

  return (
    <AppAlertBanner
      title="Mailbox permissions required"
      description="Reconnect this mailbox and approve the requested permissions. Your current workspace remains available."
      action={
        <Button asChild variant="red" size="sm">
          <Link href={prefixPath(emailAccountId, "/permissions/consent")}>
            Reconnect mailbox
          </Link>
        </Button>
      }
    />
  );
}

function subscribePermissions(listener: () => void) {
  permissionListeners.add(listener);
  return () => permissionListeners.delete(listener);
}

function setMissingPermissions(emailAccountId: string, missing: boolean) {
  if (missingPermissionAccounts.has(emailAccountId) === missing) return;
  if (missing) missingPermissionAccounts.add(emailAccountId);
  else missingPermissionAccounts.delete(emailAccountId);
  for (const listener of permissionListeners) listener();
}
