"use client";

import Link from "next/link";
import useSWR from "swr";
import { useAction } from "next-safe-action/hooks";
import { AppAlertBanner } from "@/app/(app)/AppAlertBanner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toastError } from "@/components/Toast";
import { getActionErrorMessage } from "@/utils/error";
import { clearUserErrorMessagesAction } from "@/utils/actions/error-messages";
import type { GetErrorMessagesResponse } from "@/app/api/user/error-messages/route";
import {
  ACCOUNT_DISCONNECTED_ERROR_TYPE,
  CALENDAR_DISCONNECTED_ERROR_TYPE,
} from "@/utils/config";
import type { BeeperStatus } from "@/utils/beeper/types";
import { networkName } from "@/utils/beeper/network";
import { useAccount } from "@/providers/EmailAccountProvider";
import { prefixPath } from "@/utils/path";

export function ErrorMessages({
  checkBeeper = false,
  checkLinkedIn = false,
}: {
  checkBeeper?: boolean;
  checkLinkedIn?: boolean;
}) {
  const { emailAccountId } = useAccount();
  const { data: errorMessages, mutate } = useSWR<GetErrorMessagesResponse>(
    "/api/user/error-messages",
    { refreshInterval: 15_000, revalidateOnFocus: true },
  );
  const { data: beeper } = useSWR<BeeperStatus>(
    checkBeeper ? "/api/user/messages/status" : null,
    { refreshInterval: 15_000, revalidateOnFocus: true },
  );
  const { data: linkedin } = useSWR<{ requiresReconnect: boolean }>(
    checkLinkedIn ? "/api/user/messages/contacts/linkedin" : null,
    { refreshInterval: 60_000, revalidateOnFocus: true },
  );
  const { execute: clearErrorMessages, isExecuting } = useAction(
    clearUserErrorMessagesAction,
    {
      onSuccess: () => mutate(),
      onError: ({ error }) =>
        toastError({ description: getActionErrorMessage(error) }),
    },
  );

  const {
    [ACCOUNT_DISCONNECTED_ERROR_TYPE]: disconnected,
    [CALENDAR_DISCONNECTED_ERROR_TYPE]: calendarDisconnected,
    ...otherErrors
  } = errorMessages ?? {};
  const connections = [disconnected, calendarDisconnected].filter((warning) =>
    Boolean(warning),
  );
  if (emailAccountId) {
    const beeperMessage = beeperConnectionWarning(beeper);
    if (beeperMessage)
      connections.push({
        message: beeperMessage,
        timestamp: "",
        actionUrl: prefixPath(emailAccountId, "/messages"),
        actionLabel: "Open Messages",
      });
    if (linkedin?.requiresReconnect)
      connections.push({
        message: "LinkedIn contacts need to reconnect to resume sync.",
        timestamp: "",
        actionUrl: prefixPath(emailAccountId, "/contacts"),
        actionLabel: "Open Contacts",
      });
  }
  const [connection] = connections;
  const errors = Object.values(otherErrors);
  const hasMultipleErrors = errors.length > 1;
  const singleError = errors.length === 1 ? errors[0] : null;

  return (
    <>
      {connection && (
        <AppAlertBanner
          variant="warning"
          title={
            connections.length === 1
              ? connection.message
              : `${connections.length} connection warnings`
          }
          action={
            connections.length > 1 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="xs"
                    variant="ghost"
                    className="text-inherit underline"
                  >
                    View warnings
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="max-w-[min(28rem,calc(100vw-1rem))]"
                >
                  {connections.map((warning) => (
                    <DropdownMenuItem key={warning.message} asChild>
                      <Link
                        href={warning.actionUrl}
                        className="flex min-w-0 flex-col items-start gap-0"
                      >
                        <span className="w-full break-words">
                          {warning.message}
                        </span>
                        <span className="text-xs underline">
                          {warning.actionLabel || "Reconnect"}
                        </span>
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              connection.actionUrl && (
                <Button
                  asChild
                  size="xs"
                  variant="ghost"
                  className="text-inherit underline"
                >
                  <Link href={connection.actionUrl}>
                    {connection.actionLabel || "Reconnect"}
                  </Link>
                </Button>
              )
            )
          }
        />
      )}
      {errors.length > 0 && (
        <AppAlertBanner
          title="Action Required"
          description={
            <ul className="list-none space-y-1">
              {errors.map((error) => (
                <li key={error.message}>
                  {error.message}
                  {hasMultipleErrors && error.actionUrl ? (
                    <Link className="ml-2 underline" href={error.actionUrl}>
                      {error.actionLabel || "Fix this"}
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          }
          action={
            <div className="flex items-center gap-2">
              {singleError?.actionUrl ? (
                <Button asChild variant="red" size="sm">
                  <Link href={singleError.actionUrl}>
                    {singleError.actionLabel || "Fix this"}
                  </Link>
                </Button>
              ) : null}
              <Button
                variant={singleError?.actionUrl ? "ghost" : "red"}
                size="sm"
                loading={isExecuting}
                onClick={() => clearErrorMessages()}
              >
                I've fixed them
              </Button>
            </div>
          }
        />
      )}
    </>
  );
}

function beeperConnectionWarning(status?: BeeperStatus) {
  if (!status?.configured) return;
  const phase = status.recovery?.phase;
  if (
    phase &&
    [
      "connection-required",
      "needs-login",
      "needs-key",
      "confirm-key",
      "retry-required",
      "account-mismatch",
      "verification-disabled",
    ].includes(phase)
  )
    return status.recovery?.message;

  const networks = [
    ...new Set(
      status.accounts
        .filter((account) =>
          [
            "connection_required",
            "reconnect_required",
            "attention_required",
            "disconnected",
          ].includes(account.status),
        )
        .map((account) => networkName(account.network)),
    ),
  ];
  if (networks.length)
    return `${networks.join(", ")} need attention in Beeper.`;
}
