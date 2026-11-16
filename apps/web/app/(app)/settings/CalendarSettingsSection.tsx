"use client";

import { useCallback, useId, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SWRConfig } from "swr";
import type { GetEmailAccountsResponse } from "@/app/api/user/email-accounts/route";
import {
  EmailAccountScopeProvider,
  useAccount,
} from "@/providers/EmailAccountProvider";
import { swrFetcher } from "@/providers/swr-fetcher";
import { CalendarConnections } from "@/app/(app)/[emailAccountId]/calendars/CalendarConnections";
import { BookingLinksSection } from "@/app/(app)/[emailAccountId]/calendars/BookingLinksSection";
import { AvailabilitySection } from "@/app/(app)/[emailAccountId]/calendars/AvailabilitySection";
import { CalendarSettings } from "@/app/(app)/[emailAccountId]/calendars/CalendarSettings";
import { TimezoneDetector } from "@/components/TimezoneDetector";
import { CalendarArchiveSettings } from "./CalendarArchiveSettings";
import { CalendarDefaultsSettings } from "./CalendarDefaultsSettings";

export function CalendarSettingsSection({
  accounts,
}: {
  accounts: GetEmailAccountsResponse["emailAccounts"];
}) {
  const { emailAccountId } = useAccount();
  const params = useSearchParams();
  const selectId = useId();
  const [selected, setSelected] = useState<string>();
  const selectedId =
    selected ?? params.get("calendarAccount") ?? emailAccountId;
  const account =
    accounts.find((account) => account.id === selectedId) ?? accounts[0];
  if (!account)
    return (
      <p className="text-sm text-muted-foreground">
        Connect a mailbox to configure calendars.
      </p>
    );

  return (
    <div className="space-y-5">
      <CalendarDefaultsSettings />
      <CalendarArchiveSettings />
      <div className="space-y-2">
        <label htmlFor={selectId} className="block text-sm font-medium">
          Mailbox for calendar settings
        </label>
        <select
          id={selectId}
          className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground"
          value={account.id}
          onChange={(event) => setSelected(event.target.value)}
        >
          {accounts.map((item) => (
            <option key={item.id} value={item.id}>
              {item.email}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          Manage connections, booking links, availability, and timezone for this
          mailbox. The calendar month view combines all accounts.
        </p>
      </div>
      <EmailAccountScopeProvider emailAccount={account}>
        <ScopedCalendarSettings key={account.id} emailAccountId={account.id} />
      </EmailAccountScopeProvider>
    </div>
  );
}

function ScopedCalendarSettings({
  emailAccountId,
}: {
  emailAccountId: string;
}) {
  // Calendar hooks use unscoped URL keys. Keep each selected mailbox's reads
  // isolated so switching here cannot reuse another account's settings.
  const [cache] = useState(() => new Map());
  const fetcher = useCallback(
    (key: string | [string, string]) => {
      if (Array.isArray(key)) return swrFetcher(key[0], undefined, key[1]);
      return swrFetcher(key, undefined, emailAccountId);
    },
    [emailAccountId],
  );
  return (
    <SWRConfig value={{ provider: () => cache, fetcher }}>
      <div className="space-y-4">
        <TimezoneDetector />
        <CalendarConnections />
        <BookingLinksSection />
        <AvailabilitySection />
        <CalendarSettings />
      </div>
    </SWRConfig>
  );
}
