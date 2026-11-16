import type { NewsletterStatsResponse } from "@/app/api/user/stats/newsletters/route";
export async function loadInboxNewsletters(
  accounts: { id: string; email: string }[],
  load: (id: string) => Promise<NewsletterStatsResponse>,
) {
  const results = await Promise.allSettled(
    accounts.map(async (account) => ({
      account,
      data: await load(account.id),
    })),
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
