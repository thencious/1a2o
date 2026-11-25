import type { NewsletterStatsResponse } from "@/app/api/user/stats/newsletters/route";
export async function loadInboxNewsletters(
  accounts: {
    id: string;
    email: string;
    account?: { disconnectedAt?: string | null };
  }[],
  load: (id: string) => Promise<NewsletterStatsResponse>,
) {
  const results = await Promise.allSettled(
    accounts.map(async (account) => {
      if (account.account?.disconnectedAt)
        throw new Error("Reconnect this mailbox to load its senders.");
      return { account, data: await load(account.id) };
    }),
  );
  return {
    newsletters: results.flatMap((result) =>
      result.status === "fulfilled"
        ? result.value.data.newsletters.map((row) => ({
            ...row,
            emailAccountId: result.value.account.id,
            userEmail: result.value.account.email,
          }))
        : [],
    ),
    nextCursor: null,
    searchedSenderStatus: undefined,
    accountErrors: results.flatMap((result, index) =>
      result.status === "rejected"
        ? [{ id: accounts[index].id, email: accounts[index].email }]
        : [],
    ),
  };
}
