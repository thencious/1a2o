"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useOptionalMailClient } from "@inboxzero/mail-react/MailEngineProvider";
import type { MailPredicate } from "@inboxzero/mail-core/queries";
import { labelNamesToAccountScopedPredicate } from "@/app/(app)/[emailAccountId]/mail/use-combined-mail-threads";
import type { EmailLabels } from "@/providers/email-label-types";
import { splitCountTargets } from "@/utils/split-inbox/split-counts";
import {
  readTagCountPreview,
  saveTagCountPreview,
} from "@/utils/mail-engine/mailbox-preview-cache";
import type {
  MailSplit,
  PortableLabelSplit,
} from "@/utils/split-inbox/split-query";

const EMPTY_COUNTS = new Map<string, number>();

export function useSplitCounts({
  accountIds,
  splits,
  enabled,
  portableLabelSplits,
  labelsByAccount,
}: {
  accountIds: string[];
  splits: MailSplit[];
  enabled: boolean;
  portableLabelSplits?: PortableLabelSplit[];
  labelsByAccount?: Record<string, EmailLabels>;
}) {
  const client = useOptionalMailClient();
  const accountKey = accountIds.join("\0");
  const stableAccountIds = useMemo(
    () => (accountKey ? accountKey.split("\0") : []),
    [accountKey],
  );
  const overrides = useMemo(
    () =>
      portableLabelSplits
        ? portableSplitCountOverrides({
            portableLabelSplits,
            accountIds: stableAccountIds,
            labelsByAccount,
          })
        : undefined,
    [labelsByAccount, portableLabelSplits, stableAccountIds],
  );
  const nextTargets = useMemo(
    () => [
      ...splitCountTargets({ splits, overrides }),
      {
        id: "mailbox:spam",
        predicate: { kind: "mailbox" as const, mailbox: "spam" as const },
      },
      {
        id: "mailbox:trash",
        predicate: { kind: "mailbox" as const, mailbox: "trash" as const },
      },
    ],
    [overrides, splits],
  );
  // Settings refreshes and reorders hand over new split objects with the same
  // conditions. Reopening the count observer for those blanks every count.
  const targetsKey = JSON.stringify(
    nextTargets.toSorted((a, b) => a.id.localeCompare(b.id)),
  );
  const stableTargetsRef = useRef({ key: targetsKey, targets: nextTargets });
  if (stableTargetsRef.current.key !== targetsKey) {
    stableTargetsRef.current = { key: targetsKey, targets: nextTargets };
  }
  const targets = stableTargetsRef.current.targets;
  const identity = JSON.stringify({
    accountIds: [...stableAccountIds].sort(),
    countSplits: [...splits].sort((a, b) => a.id.localeCompare(b.id)),
    mailboxViews: true,
    portableLabelSplits,
  });
  const cachedCounts = useMemo(() => readTagCountPreview(identity), [identity]);
  const [liveCounts, setLiveCounts] = useState({
    identity: "",
    counts: EMPTY_COUNTS,
  });

  useEffect(() => {
    if (
      !client ||
      !enabled ||
      stableAccountIds.length === 0 ||
      targets.length === 0
    ) {
      return;
    }

    const handle = client.observeMailboxCounts({
      accountIds: stableAccountIds,
      targets,
    });
    const apply = () => {
      const snapshot = handle.getSnapshot();
      if (snapshot.status !== "ready" || !snapshot.data) return;
      const next = new Map(cachedCounts);
      for (const count of snapshot.data.counts) {
        next.set(count.id, count.matchingConversations);
      }
      saveTagCountPreview(identity, next);
      setLiveCounts((current) =>
        current.identity === identity && sameCounts(current.counts, next)
          ? current
          : { identity, counts: next },
      );
    };
    const unsubscribe = handle.subscribe(apply);
    apply();
    return () => {
      unsubscribe();
      handle.close();
    };
  }, [client, enabled, stableAccountIds, targets, identity, cachedCounts]);

  return enabled
    ? liveCounts.identity === identity
      ? liveCounts.counts
      : cachedCounts
    : EMPTY_COUNTS;
}

function portableSplitCountOverrides({
  portableLabelSplits,
  accountIds,
  labelsByAccount,
}: {
  portableLabelSplits: PortableLabelSplit[];
  accountIds: string[];
  labelsByAccount?: Record<string, EmailLabels>;
}) {
  const labelsReady = Object.keys(labelsByAccount ?? {}).length > 0;
  const overrides = new Map<string, MailPredicate | null>();
  for (const split of portableLabelSplits) {
    overrides.set(
      split.id,
      labelsReady && labelsByAccount
        ? labelNamesToAccountScopedPredicate({
            accountIds,
            labelsByAccount,
            labelNames: split.labelNames,
          })
        : null,
    );
  }
  return overrides;
}

function sameCounts(left: Map<string, number>, right: Map<string, number>) {
  if (left.size !== right.size) return false;
  for (const [id, count] of right) {
    if (left.get(id) !== count) return false;
  }
  return true;
}
