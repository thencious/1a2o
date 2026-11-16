"use client";

import { useMemo, useRef } from "react";
import type { MailPredicate } from "@inboxzero/mail-core/queries";
import useSWR from "swr";
import { useSWRConfig, unstable_serialize } from "swr";
import { useAccounts } from "@/hooks/useAccounts";
import { loadCombinedLabels } from "./load-combined-labels";
import { useEngineMailThreads } from "@/app/(app)/[emailAccountId]/mail/use-engine-mail-threads";
import type { LabelsResponse } from "@/app/api/labels/route";
import type { EmailLabels } from "@/providers/email-label-types";
import type { CombinedListThread } from "@/utils/threads/load-combined";
import type { ThreadsQuery } from "@/utils/threads/validation";
import {
  splitSelectionPredicate,
  type SplitSelection,
} from "@/utils/split-inbox/split-selection";
import {
  type MailSplit,
  type PortableLabelSplit,
  mailSplitToThreadsQuery,
} from "@/utils/split-inbox/split-query";
import { threadsQueryToPredicate } from "@/utils/mail-engine/threads-query";

const EMPTY_LABELS_BY_ACCOUNT: Record<string, EmailLabels> = {};
const MAX_MAIL_PREDICATE_CHILDREN = 32;

export function useCombinedMailThreads({
  accounts,
  emailAccountId,
  enabled,
  isUnread,
  labelNames,
  searchQuery,
  splitSelection,
  splits = [],
  portableLabelSplits = [],
  mailboxType,
  scopeQuery,
}: {
  accounts: CombinedListThread["account"][];
  emailAccountId: string;
  enabled: boolean;
  isUnread: boolean;
  labelNames?: string[];
  searchQuery?: string;
  splitSelection?: SplitSelection;
  splits?: MailSplit[];
  portableLabelSplits?: PortableLabelSplit[];
  mailboxType?: "spam" | "trash";
  scopeQuery?: ThreadsQuery | null;
}) {
  const accountIds = useMemo(
    () => accounts.map((account) => account.id),
    [accounts],
  );
  const accountsById = useMemo(
    () => Object.fromEntries(accounts.map((account) => [account.id, account])),
    [accounts],
  );
  const labelsByAccount = useLabelsByAccount(enabled ? accountIds : []);
  const predicate = useMemo(
    () =>
      splitSelection
        ? splitSelectionPredicate(splitSelection, splits, (split) => {
            const portable = portableLabelSplits.find(
              (item) => item.id === split.id,
            );
            return portable
              ? labelNamesToAccountScopedPredicate({
                  accountIds,
                  labelsByAccount,
                  labelNames: portable.labelNames,
                })
              : threadsQueryToPredicate(mailSplitToThreadsQuery(split));
          })
        : labelNames?.length
          ? labelNamesToAccountScopedPredicate({
              accountIds,
              labelsByAccount,
              labelNames,
            })
          : undefined,
    [
      accountIds,
      labelNames,
      labelsByAccount,
      splitSelection,
      splits,
      portableLabelSplits,
    ],
  );
  const query = useMemo(
    () =>
      combinedMailThreadsQuery({
        searchQuery,
        scopeQuery,
        mailboxType,
        labelNames,
        isUnread,
      }),
    [isUnread, labelNames, searchQuery, mailboxType, scopeQuery],
  );
  const waitingForLabels = Boolean(
    splitSelection &&
      portableLabelSplits.some((split) =>
        splitSelection.ids.includes(split.id),
      ) &&
      !Object.keys(labelsByAccount).length,
  );
  const state = useEngineMailThreads({
    emailAccountId,
    accountIds: accountIds.length ? accountIds : [emailAccountId],
    accounts: accountsById,
    query,
    predicate: searchQuery || mailboxType || scopeQuery ? undefined : predicate,
    enabled: enabled && !waitingForLabels,
  });
  return {
    ...state,
    isLoading: state.isLoading || (enabled && waitingForLabels),
    labelsByAccount,
  };
}

export function combinedMailThreadsQuery(input: {
  searchQuery?: string;
  scopeQuery?: ThreadsQuery | null;
  mailboxType?: "spam" | "trash";
  labelNames?: string[];
  isUnread: boolean;
}): ThreadsQuery {
  if (input.searchQuery) return { q: input.searchQuery };
  if (input.scopeQuery) return input.scopeQuery;
  if (input.mailboxType) return { type: input.mailboxType };
  if (input.labelNames?.length) return { type: "inbox" };
  return { type: input.isUnread ? "unread" : "inbox" };
}

function useLabelsByAccount(accountIds: string[]): Record<string, EmailLabels> {
  const { fetcher, cache, mutate } = useSWRConfig();
  const { data: accounts, mutate: refreshAccounts } = useAccounts(
    accountIds.length > 0,
  );
  const retained = useRef<Record<string, EmailLabels>>({});
  const unavailableIds = useMemo(
    () =>
      new Set(
        accounts?.emailAccounts
          .filter(
            (account) =>
              account.account.disconnectedAt || account.providerRateLimit,
          )
          .map((account) => account.id) ?? [],
      ),
    [accounts],
  );
  const accountKey = useMemo(
    () =>
      JSON.stringify([
        [...accountIds].sort(),
        [...unavailableIds].filter((id) => accountIds.includes(id)).sort(),
      ]),
    [accountIds, unavailableIds],
  );
  const { data } = useSWR(
    fetcher && accountIds.length
      ? ["mail-labels-by-account", accountKey]
      : null,
    async () => {
      if (!fetcher) return {};
      let needsReconnect = false;
      const next = await loadCombinedLabels({
        accountIds,
        previous: {
          ...(cache.get(
            unstable_serialize(["mail-labels-by-account", accountKey]),
          )?.data as Record<string, EmailLabels> | undefined),
          ...retained.current,
        },
        fetchLabels: async (accountId) => {
          if (unavailableIds.has(accountId)) return;
          try {
            return (await fetcher(["/api/labels", accountId])) as
              | LabelsResponse
              | undefined;
          } catch (error) {
            if (
              error &&
              typeof error === "object" &&
              "retryable" in error &&
              error.retryable === false
            )
              needsReconnect = true;
            throw error;
          }
        },
      });
      retained.current = { ...retained.current, ...next };
      if (needsReconnect)
        Promise.allSettled([
          refreshAccounts(),
          mutate("/api/user/error-messages"),
        ]);
      return next;
    },
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
      keepPreviousData: true,
    },
  );
  return data ?? EMPTY_LABELS_BY_ACCOUNT;
}

export function labelNamesToAccountScopedPredicate({
  accountIds,
  labelsByAccount,
  labelNames,
}: {
  accountIds: string[];
  labelsByAccount: Record<string, EmailLabels>;
  labelNames: string[];
}): MailPredicate {
  const wantedNames = new Set(labelNames.map((name) => name.trim()));
  const predicates: MailPredicate[] = [];
  const seen = new Set<string>();

  for (const accountId of accountIds) {
    for (const label of Object.values(labelsByAccount[accountId] ?? {})) {
      if (!label.id || !wantedNames.has(label.name.trim())) continue;
      const key = JSON.stringify([accountId, label.id]);
      if (seen.has(key)) continue;
      seen.add(key);
      predicates.push({
        kind: "membership",
        membership: "label",
        id: label.id,
        accountId,
      });
    }
  }

  return {
    kind: "all",
    predicates: [{ kind: "role", role: "inbox" }, anyPredicate(predicates)],
  };
}

function anyPredicate(predicates: MailPredicate[]): MailPredicate {
  if (predicates.length <= MAX_MAIL_PREDICATE_CHILDREN) {
    return { kind: "any", predicates };
  }
  const chunks: MailPredicate[] = [];
  for (
    let index = 0;
    index < predicates.length;
    index += MAX_MAIL_PREDICATE_CHILDREN
  ) {
    chunks.push({
      kind: "any",
      predicates: predicates.slice(index, index + MAX_MAIL_PREDICATE_CHILDREN),
    });
  }
  return { kind: "any", predicates: chunks };
}
