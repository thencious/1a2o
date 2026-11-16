import { describe, expect, it } from "vitest";
import { mailPredicateSchema } from "@inboxzero/mail-core/queries";
import {
  labelNamesToAccountScopedPredicate,
  combinedMailThreadsQuery,
} from "./use-combined-mail-threads";

describe("combined mailbox views", () => {
  it.each([
    "sent",
    "draft",
    "archive",
  ] as const)("opens %s across accounts without applying inbox filters", (type) => {
    expect(
      combinedMailThreadsQuery({
        scopeQuery: { type },
        isUnread: true,
        labelNames: ["Marketing"],
      }),
    ).toEqual({ type });
  });
  it("lets an explicit search override an open mailbox", () => {
    expect(
      combinedMailThreadsQuery({
        scopeQuery: { type: "sent" },
        searchQuery: "from:someone@example.com",
        isUnread: false,
      }),
    ).toEqual({ q: "from:someone@example.com" });
  });
});

describe("labelNamesToAccountScopedPredicate", () => {
  it("resolves the same label name to each account's own label id", () => {
    expect(
      labelNamesToAccountScopedPredicate({
        accountIds: ["acc-1", "acc-2"],
        labelNames: ["Customers"],
        labelsByAccount: {
          "acc-1": {
            "label-a": { id: "label-a", name: "Customers", type: "user" },
          },
          "acc-2": {
            "label-b": { id: "label-b", name: "Customers", type: "user" },
          },
        },
      }),
    ).toEqual({
      kind: "all",
      predicates: [
        { kind: "role", role: "inbox" },
        {
          kind: "any",
          predicates: [
            {
              kind: "membership",
              membership: "label",
              id: "label-a",
              accountId: "acc-1",
            },
            {
              kind: "membership",
              membership: "label",
              id: "label-b",
              accountId: "acc-2",
            },
          ],
        },
      ],
    });
  });

  it("does not let the same label id on another account match a different name", () => {
    expect(
      labelNamesToAccountScopedPredicate({
        accountIds: ["acc-1", "acc-2"],
        labelNames: ["Customers"],
        labelsByAccount: {
          "acc-1": {
            shared: { id: "shared", name: "Customers", type: "user" },
          },
          "acc-2": {
            shared: { id: "shared", name: "Suppliers", type: "user" },
          },
        },
      }),
    ).toEqual({
      kind: "all",
      predicates: [
        { kind: "role", role: "inbox" },
        {
          kind: "any",
          predicates: [
            {
              kind: "membership",
              membership: "label",
              id: "shared",
              accountId: "acc-1",
            },
          ],
        },
      ],
    });
  });

  it("matches no rows while selected label mappings are unloaded", () => {
    expect(
      labelNamesToAccountScopedPredicate({
        accountIds: ["acc-1"],
        labelNames: ["Customers"],
        labelsByAccount: {},
      }),
    ).toEqual({
      kind: "all",
      predicates: [
        { kind: "role", role: "inbox" },
        { kind: "any", predicates: [] },
      ],
    });
  });

  it("chunks more than 32 account labels into schema-valid OR groups", () => {
    const accountIds = Array.from({ length: 40 }, (_, index) => `acc-${index}`);
    const labelsByAccount = Object.fromEntries(
      accountIds.map((accountId) => [
        accountId,
        {
          label: { id: `label-${accountId}`, name: "Customers", type: "user" },
        },
      ]),
    );

    const predicate = labelNamesToAccountScopedPredicate({
      accountIds,
      labelNames: ["Customers"],
      labelsByAccount,
    });

    expect(mailPredicateSchema.parse(predicate)).toEqual(predicate);
  });
});
