"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { ArrowLeft, ContactRound, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LinkedInContactsConnection } from "@/components/LinkedInContactsConnection";
import { MailListToolbarSurface } from "@inboxzero/mail-ui/MailListToolbarSurface";
import {
  ResizablePanel,
  ResizablePanelGroup,
  ResizableHandle,
} from "@/components/ui/resizable";
import { SplitTabs } from "../mail/SplitTabs";
import { refreshBeeperContactsAction } from "@/utils/actions/beeper-contacts";
import { getActionErrorMessage } from "@/utils/error";
import { getAccountLinkingUrl } from "@/utils/account-linking";
import { redirectToSafeUrl } from "@/utils/redirect";
import { networkName, networkColor } from "@/utils/beeper/network";
import {
  mergeContacts,
  contactValues,
  contactNetworkKey,
  type UnifiedContact,
} from "@/utils/contacts/merge";
import type {
  BeeperContact,
  ContactAccount,
  ContactsSnapshot,
} from "@/utils/beeper/contact-types";

export function ContactsWorkspace() {
  const { data, error, isLoading, mutate } = useSWR<ContactsSnapshot>(
    "/api/user/messages/contacts",
    readContacts,
    { revalidateOnFocus: false, refreshInterval: 60_000 },
  );
  const [query, setQuery] = useState("");
  const [network, setNetwork] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [limit, setLimit] = useState(200);
  const [refreshing, setRefreshing] = useState(false);
  const [failure, setFailure] = useState("");
  const autoRefreshed = useRef(false);
  const refresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    setFailure("");
    try {
      const result = await refreshBeeperContactsAction();
      if (!result?.data) throw new Error(getActionErrorMessage(result ?? {}));
      await mutate();
    } catch (error) {
      setFailure(
        error instanceof Error ? error.message : "Could not refresh contacts.",
      );
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, mutate]);
  useEffect(() => {
    if (!data || autoRefreshed.current) return;
    autoRefreshed.current = true;
    if (Date.now() - Date.parse(data.updatedAt) > 15 * 60_000) refresh();
  }, [data, refresh]);
  const accounts = data?.accounts ?? [];
  const rows = useMemo(() => mergeContacts(data?.accounts ?? []), [data]);
  const names = [
    ...new Set(accounts.map((account) => networkName(account.network))),
  ].sort();
  const matches = rows
    .filter(
      (row) =>
        (!network ||
          row.profiles.some(
            (profile) =>
              contactNetworkKey(profile.network) === contactNetworkKey(network),
          )) &&
        row.profiles
          .flatMap((profile) =>
            profile.sources.flatMap((source) => [
              ...Object.values(source.contact),
              source.account.name,
              profile.network,
              ...profile.links,
            ]),
          )
          .join(" ")
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
    )
    .sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
  const current = rows.find((row) =>
    row.profiles.some((profile) =>
      profile.sources.some((source) => source.key === selected),
    ),
  );
  const shownAccounts = accounts.filter(
    (account) => !network || networkName(account.network) === network,
  );
  const linkedInSyncAccount =
    accounts.find(
      (account) =>
        account.source === "linkedin-session" ||
        account.source === "linkedin-portability",
    ) ??
    accounts.find((account) =>
      account.network.toLowerCase().includes("linkedin"),
    );
  const counts = new Map([
    ["all", rows.length],
    ...names.map(
      (name) =>
        [
          name,
          rows.filter((row) =>
            row.profiles.some(
              (profile) =>
                contactNetworkKey(profile.network) === contactNetworkKey(name),
            ),
          ).length,
        ] as [string, number],
    ),
  ]);
  const selectNetwork = (value: string) => {
    setNetwork(value === "all" ? null : value);
    setLimit(200);
  };
  return (
    <section
      aria-label="Unified contacts"
      data-command-context={JSON.stringify({
        tab: "contacts",
        contactKey: current?.key ?? "",
        title: current?.name ?? "",
      })}
      className="flex h-[calc(100dvh-2.25rem)] min-h-0 flex-col overflow-hidden bg-background lg:h-dvh"
    >
      <h1 className="sr-only">Contacts</h1>
      <ResizablePanelGroup
        direction="horizontal"
        autoSaveId="messages-contacts-split"
        className="min-h-0 flex-1"
      >
        <ResizablePanel
          defaultSize={43}
          minSize={25}
          className={current ? "hidden min-w-0 md:block" : "min-w-0"}
        >
          <div className="flex h-full min-h-0 flex-col">
            <MailListToolbarSurface>
              <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-sidebar px-2.5 text-muted-foreground focus-within:ring-2 focus-within:ring-ring">
                <Search className="size-3.5 shrink-0" />
                <input
                  aria-label="Search contacts"
                  placeholder="Search all contacts"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setLimit(200);
                  }}
                  className="h-7 min-w-0 flex-1 border-0 bg-transparent px-0 py-0 text-sm outline-none focus:ring-0"
                />
              </div>
              <Button
                variant="outline"
                size="icon"
                className="size-8 shrink-0 rounded-lg"
                aria-label="Refresh contacts"
                title="Refresh contacts"
                disabled={refreshing || isLoading}
                onClick={refresh}
              >
                <RefreshCw
                  className={`size-3.5 ${refreshing || isLoading ? "animate-spin" : ""}`}
                />
              </Button>
            </MailListToolbarSurface>
            <div role="group" aria-label="Contact platforms">
              <SplitTabs
                splits={[
                  { name: "All", id: "all", deletable: false },
                  ...names.map((name) => ({
                    name,
                    id: name,
                    deletable: false,
                    style: {
                      backgroundColor: networkColor(name, 22, 22),
                      color: networkColor(name, 50, 78),
                    },
                  })),
                ]}
                activeSplitId={network ?? "all"}
                countsById={counts}
                selectedSplitIds={new Set([network ?? "all"])}
                onSelect={selectNetwork}
                onFocus={selectNetwork}
                onNewSplit={() => {}}
                canCreateSplits={false}
              />
            </div>
            <div
              className="flex items-center justify-between gap-3 border-b px-3 py-2 text-xs text-muted-foreground"
              role="status"
            >
              <span className="min-w-0 truncate">
                {isLoading
                  ? "Reading contacts from every account and page…"
                  : refreshing
                    ? "Refreshing…"
                    : ""}
              </span>
              {data && (
                <span className="ml-auto shrink-0 whitespace-nowrap">
                  Last refresh {new Date(data.updatedAt).toLocaleString()}
                </span>
              )}
            </div>
            {(error || failure) && (
              <p role="alert" className="border-b p-3 text-xs text-destructive">
                {failure || error.message}
                <Button
                  variant="ghost"
                  onClick={() => (data ? refresh() : mutate())}
                >
                  Retry
                </Button>
              </p>
            )}
            <div
              role="list"
              aria-label="Contacts"
              className="min-h-0 flex-1 overflow-auto"
            >
              {matches.slice(0, limit).map((person) => (
                <div key={person.key} role="listitem">
                  <button
                    type="button"
                    aria-label={`${person.name} on ${person.profiles.map((profile) => profile.network).join(", ")}`}
                    aria-pressed={current?.key === person.key}
                    onClick={() =>
                      setSelected(person.profiles[0].sources[0].key)
                    }
                    className={`flex w-full items-center gap-2 border-b border-l-2 px-3 py-2 text-left hover:bg-muted/50 ${current?.key === person.key ? "bg-muted" : ""}`}
                    style={{
                      borderLeftColor: networkColor(
                        network ?? person.profiles[0].network,
                        50,
                        52,
                      ),
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{person.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {contactValues(person, "email")[0] ||
                          contactValues(person, "phoneNumber")[0] ||
                          contactValues(person, "username")[0] ||
                          person.profiles
                            .map((profile) => profile.network)
                            .join(" · ")}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end gap-1">
                      {person.profiles.map((profile) => (
                        <span
                          key={profile.key}
                          className="shrink-0 rounded px-1.5 py-0.5 text-[10px]"
                          style={{
                            backgroundColor: networkColor(
                              profile.network,
                              22,
                              22,
                            ),
                            color: networkColor(profile.network, 50, 78),
                          }}
                        >
                          {profile.network}
                        </span>
                      ))}
                    </div>
                  </button>
                </div>
              ))}
              {matches.length > limit && (
                <Button
                  variant="ghost"
                  className="w-full"
                  onClick={() => setLimit((value) => value + 200)}
                >
                  Show more contacts (
                  {(matches.length - limit).toLocaleString()} remaining)
                </Button>
              )}
              {!isLoading && !matches.length && (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  {query
                    ? "No contacts match this search."
                    : network
                      ? `Beeper returned no contacts for ${network}. This does not mean you have no connections there.`
                      : "Beeper has not provided any contacts yet."}
                </p>
              )}
            </div>
          </div>
        </ResizablePanel>
        <ResizableHandle
          aria-label="Resize contacts columns"
          className="hidden w-1.5 cursor-col-resize bg-border/40 hover:bg-muted-foreground/40 dark:bg-border/40 md:flex"
        />
        <ResizablePanel
          defaultSize={57}
          minSize={30}
          className={current ? "min-w-0" : "hidden min-w-0 md:block"}
        >
          <div className="h-full overflow-auto p-5 text-sm">
            {current ? (
              <>
                <Button
                  variant="ghost"
                  className="mb-3 md:hidden"
                  onClick={() => setSelected(null)}
                >
                  <ArrowLeft className="mr-2 size-4" />
                  Contacts
                </Button>
                <UnifiedContactDetail person={current} />
              </>
            ) : (
              <div className="mb-5 flex items-center gap-2 text-muted-foreground">
                <ContactRound className="size-5" />
                Select a contact to view their details.
              </div>
            )}
            <div className="mt-6 border-t pt-4">
              <h2 className="mb-2 font-medium">Contacts by account</h2>
              <p className="mb-3 text-xs text-muted-foreground">
                Email address books, Beeper contacts and LinkedIn connections.
                Duplicate matching runs automatically whenever contacts change.
              </p>
              {shownAccounts.map((account) => (
                <div key={account.id} className="border-b py-3 text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <span
                      className="min-w-0 flex-1"
                      style={{ color: networkColor(account.network, 50, 78) }}
                    >
                      {networkName(account.network)} · {account.name}
                    </span>
                    {account.id === linkedInSyncAccount?.id && (
                      <LinkedInContactsConnection onChange={() => mutate()} />
                    )}
                    <strong className="shrink-0 whitespace-nowrap text-right tabular-nums">
                      {account.contacts.length.toLocaleString()}
                    </strong>
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    {account.error
                      ? account.error
                      : `All ${account.pages} API page${account.pages === 1 ? "" : "s"} read${account.contacts.length ? "" : "; no contacts returned"}.`}
                  </p>
                  {account.source === "email-contacts" &&
                    account.reconnectRequired && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-2"
                        onClick={async () => {
                          if (!account.emailProvider || !account.emailAccountId)
                            return;
                          try {
                            const url = await getAccountLinkingUrl(
                              account.emailProvider,
                              {
                                reconnectEmailAccountId: account.emailAccountId,
                              },
                            );
                            redirectToSafeUrl(url, { allowExternal: true });
                          } catch (error) {
                            setFailure(
                              error instanceof Error
                                ? error.message
                                : "Could not request contacts access.",
                            );
                          }
                        }}
                      >
                        Enable contacts
                      </Button>
                    )}
                  {account.apiDisabled && (
                    <a
                      className="mt-2 block underline"
                      href="https://console.cloud.google.com/apis/library/people.googleapis.com"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Enable Google People API
                    </a>
                  )}
                  {account.error && account.fetchedAt && (
                    <p className="mt-1 text-muted-foreground">
                      Saved results from{" "}
                      {new Date(account.fetchedAt).toLocaleString()}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </section>
  );
}
function UnifiedContactDetail({ person }: { person: UnifiedContact }) {
  const details = [
    ["Email", contactValues(person, "email")],
    ["Phone", contactValues(person, "phoneNumber")],
    ["Company", contactValues(person, "company")],
    ["Position", contactValues(person, "position")],
  ] as const;
  return (
    <>
      <h2 className="mb-2 text-lg font-medium">{person.name}</h2>
      {person.ambiguous && (
        <p className="mb-4 text-xs text-muted-foreground">
          Multiple profiles in the same app share this name. They are kept
          separate to avoid combining different people.
        </p>
      )}
      <dl className="mb-5 grid grid-cols-[auto_1fr] gap-x-5 gap-y-3 text-sm">
        {details
          .filter(([, values]) => values.length)
          .map(([label, values]) => (
            <div className="contents" key={label}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 break-words select-text">
                {values.map((value) => (
                  <div key={value}>{value}</div>
                ))}
              </dd>
            </div>
          ))}
      </dl>
      <h3 className="mb-2 text-sm font-medium">Profiles</h3>
      {person.profiles.map((profile) => (
        <section key={profile.key} className="mb-3 rounded-lg border p-3">
          <h4
            className="mb-2 text-sm font-medium"
            style={{ color: networkColor(profile.network, 50, 78) }}
          >
            {profile.network}
          </h4>
          <div className="mb-3 space-y-1">
            {profile.links.map((link) => (
              <a
                key={link}
                href={link}
                target="_blank"
                rel="noreferrer"
                className="block break-all text-xs underline"
              >
                {link}
              </a>
            ))}
          </div>
          {profile.sources.map((source, index) => (
            <div
              key={`${source.key}:${index}`}
              className="border-t py-3 first:border-t-0"
            >
              <SourceContactDetail
                contact={source.contact}
                account={source.account}
              />
              <p className="mt-3 break-all text-xs text-muted-foreground select-text">
                Profile ID: {source.contact.id}
              </p>
            </div>
          ))}
        </section>
      ))}
    </>
  );
}
function SourceContactDetail({
  contact,
  account,
}: {
  contact: BeeperContact;
  account: Pick<ContactAccount, "id" | "name" | "network" | "source">;
}) {
  return (
    <>
      <h2 className="mb-1 text-lg font-medium">{contact.name}</h2>
      <p
        className="mb-5 text-xs"
        style={{ color: networkColor(account.network, 50, 78) }}
      >
        {networkName(account.network)} · {account.name}
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-3 text-sm">
        {contact.profileUnavailable && (
          <>
            <dt className="text-muted-foreground">Profile</dt>
            <dd>LinkedIn has not supplied this member’s profile details.</dd>
          </>
        )}
        {contact.profileUrl && (
          <>
            <dt className="text-muted-foreground">Profile</dt>
            <dd>
              <a
                className="underline"
                href={contact.profileUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open profile
              </a>
            </dd>
          </>
        )}
        {contact.company && (
          <>
            <dt className="text-muted-foreground">Company</dt>
            <dd>{contact.company}</dd>
          </>
        )}
        {contact.position && (
          <>
            <dt className="text-muted-foreground">Position</dt>
            <dd>{contact.position}</dd>
          </>
        )}
        {contact.connectedOn && (
          <>
            <dt className="text-muted-foreground">Connected</dt>
            <dd>{contact.connectedOn}</dd>
          </>
        )}
        {contact.username && (
          <>
            <dt className="text-muted-foreground">Username</dt>
            <dd className="break-all select-text">{contact.username}</dd>
          </>
        )}
        {contact.phoneNumber && (
          <>
            <dt className="text-muted-foreground">Phone</dt>
            <dd className="break-all select-text">{contact.phoneNumber}</dd>
          </>
        )}
        {contact.email && (
          <>
            <dt className="text-muted-foreground">Email</dt>
            <dd className="break-all select-text">{contact.email}</dd>
          </>
        )}
      </dl>
      {Object.entries(contact.details ?? {})
        .filter(([, values]) => values.length)
        .map(([label, values]) => (
          <div key={label} className="mt-3 text-sm">
            <div className="text-muted-foreground">{label}</div>
            {values.map((value) => (
              <p
                className="whitespace-pre-wrap break-words select-text"
                key={value}
              >
                {value}
              </p>
            ))}
          </div>
        ))}
      {!contact.username &&
        account.source !== "conversation-extraction" &&
        !contact.phoneNumber &&
        !contact.email &&
        !contact.profileUrl &&
        !contact.company &&
        !contact.position && (
          <p className="text-xs text-muted-foreground">
            Beeper has not supplied a username, phone number, or email for this
            contact.
          </p>
        )}
      {account.source === "linkedin-session" ||
      account.source === "linkedin-portability" ? (
        <p className="mt-4 text-xs text-muted-foreground">
          Imported directly from LinkedIn. Open the profile to message this
          connection, or use their existing Beeper conversation.
        </p>
      ) : (
        contact.cannotMessage && (
          <p className="mt-4 text-xs text-muted-foreground">
            Beeper reports that a new direct message cannot currently be started
            with this contact.
          </p>
        )
      )}
    </>
  );
}
async function readContacts(url: string): Promise<ContactsSnapshot> {
  const response = await fetch(url, { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not load contacts.");
  return data;
}
