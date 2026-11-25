"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import useSWR from "swr";
import { AddAccount } from "./AddAccount";
import type { GetEmailAccountsResponse } from "@/app/api/user/email-accounts/route";
import { LinkedInContactsConnection } from "@/components/LinkedInContactsConnection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { connectBeeperAction } from "@/utils/actions/beeper";
import { completedOnboardingAction } from "@/utils/actions/onboarding";
import type { BeeperStatus } from "@/utils/beeper/types";
import { getActionErrorMessage } from "@/utils/error";
import { prefixPath } from "@/utils/path";

export type AccountOnboardingOptions = {
  enabledProviders: ("google" | "microsoft")[];
  calendarConnections: { mailboxId: string; email: string; provider: string }[];
  beeperAvailable: boolean;
  contactsEnabled: boolean;
};

export function AccountOnboarding({
  accounts,
  enabledProviders,
  calendarConnections,
  beeperAvailable,
  contactsEnabled,
}: AccountOnboardingOptions & {
  accounts: GetEmailAccountsResponse["emailAccounts"];
}) {
  const router = useRouter();
  const [finishing, setFinishing] = useState(false);
  const [failure, setFailure] = useState("");
  const usableMailboxes = accounts.filter(
    ({ account }) => !account.disconnectedAt,
  );

  async function finish() {
    setFinishing(true);
    setFailure("");
    try {
      const result = await completedOnboardingAction();
      if (!result?.data?.completed)
        throw new Error(getActionErrorMessage(result ?? {}));
      router.replace("/mail?accountScope=all&split=all");
    } catch (error) {
      setFailure(
        error instanceof Error ? error.message : "Could not finish setup.",
      );
      setFinishing(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-5 py-6">
      <p className="text-sm text-muted-foreground">
        Connect the accounts you want in 1a2o. You can add more later.
      </p>

      <section
        aria-labelledby="setup-mail"
        className="space-y-3 rounded-lg border p-4"
      >
        <h2 id="setup-mail" className="font-medium">
          Mail and calendar
        </h2>
        <p className="text-sm text-muted-foreground">
          Approve mail and calendar access together for each account.
        </p>
        <ul className="divide-y text-sm">
          {accounts.map((mailbox) => {
            const { provider, disconnectedAt } = mailbox.account;
            const supportsCalendar =
              (provider === "google" || provider === "microsoft") &&
              enabledProviders.includes(provider);
            const calendarConnected =
              supportsCalendar &&
              calendarConnections.some(
                (connection) =>
                  connection.mailboxId === mailbox.id &&
                  connection.provider === provider &&
                  connection.email.toLowerCase() ===
                    mailbox.email.toLowerCase(),
              );
            return (
              <li
                key={mailbox.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <span className="min-w-0 break-words">{mailbox.email}</span>
                {disconnectedAt || (supportsCalendar && !calendarConnected) ? (
                  <Link
                    href={prefixPath(mailbox.id, "/permissions/consent")}
                    className="underline"
                  >
                    {disconnectedAt
                      ? "Reconnect account"
                      : "Allow calendar access"}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">
                    {calendarConnected
                      ? "Mail and calendar connected"
                      : "Mail connected"}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        <AddAccount
          providers={enabledProviders}
          helperText={
            contactsEnabled
              ? "Approve contacts access in the provider prompt to import your address book."
              : null
          }
        />
      </section>

      {beeperAvailable && <BeeperOnboarding />}

      <section
        aria-labelledby="setup-contacts"
        className="flex items-center justify-between gap-3 rounded-lg border p-4"
      >
        <div>
          <h2 id="setup-contacts" className="font-medium">
            LinkedIn contacts
          </h2>
          <p className="text-sm text-muted-foreground">
            Connect LinkedIn to import your connections.
          </p>
        </div>
        <LinkedInContactsConnection />
      </section>

      {failure && (
        <p role="alert" className="text-sm text-destructive">
          {failure}
        </p>
      )}
      <Button
        onClick={finish}
        loading={finishing}
        disabled={!usableMailboxes.length}
      >
        Open All inboxes
      </Button>
    </div>
  );
}

function BeeperOnboarding() {
  const { data, mutate } = useSWR<BeeperStatus>("/api/user/messages/status", {
    refreshInterval: 5000,
  });
  const [token, setToken] = useState("");
  const [failure, setFailure] = useState("");
  const [connecting, setConnecting] = useState(false);

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setConnecting(true);
    setFailure("");
    try {
      const result = await connectBeeperAction({ token: token.trim() });
      if (!result?.data || result.serverError || result.validationErrors)
        throw new Error(getActionErrorMessage(result ?? {}));
      setToken("");
      await mutate();
    } catch (error) {
      setFailure(
        error instanceof Error ? error.message : "Could not connect Beeper.",
      );
    } finally {
      setConnecting(false);
    }
  }

  return (
    <section
      aria-labelledby="setup-messages"
      className="space-y-3 rounded-lg border p-4"
    >
      <h2 id="setup-messages" className="font-medium">
        Messages
      </h2>
      {data?.running ? (
        <p className="text-sm text-muted-foreground">
          Beeper connected
          {data.accounts.length
            ? ` · ${data.accounts.length} messaging accounts`
            : ""}
        </p>
      ) : (
        <form className="space-y-2" onSubmit={connect}>
          <p className="text-sm text-muted-foreground">
            Link your messaging accounts in Beeper Desktop, then approve a
            connection in its Desktop API settings.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label="Beeper access token"
              placeholder="Beeper access token"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              className="w-full sm:w-64"
            />
            <Button
              type="submit"
              variant="outline"
              loading={connecting}
              disabled={!token.trim()}
            >
              Connect Beeper
            </Button>
          </div>
          {failure && (
            <p role="alert" className="text-sm text-destructive">
              {failure}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
