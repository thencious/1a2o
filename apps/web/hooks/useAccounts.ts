import useSWR from "swr";
import type { GetEmailAccountsResponse } from "@/app/api/user/email-accounts/route";
import {
  EMAIL_ACCOUNTS_KEY,
  fetchEmailAccounts,
} from "@/utils/fetch-email-accounts";

export function useAccounts(enabled = true, watchConnection = false) {
  return useSWR<GetEmailAccountsResponse>(
    enabled ? EMAIL_ACCOUNTS_KEY : null,
    fetchEmailAccounts,
    {
      revalidateOnFocus: watchConnection,
      refreshInterval: watchConnection ? 20_000 : 0,
    },
  );
}
