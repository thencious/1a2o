import type { LabelsResponse } from "@/app/api/labels/route";
import type { EmailLabels } from "@/providers/email-label-types";

export async function loadCombinedLabels({
  accountIds,
  fetchLabels,
  previous = {},
}: {
  accountIds: string[];
  fetchLabels: (accountId: string) => Promise<LabelsResponse | undefined>;
  previous?: Record<string, EmailLabels>;
}): Promise<Record<string, EmailLabels>> {
  const results = await Promise.allSettled(accountIds.map(fetchLabels));
  return Object.fromEntries(
    accountIds.map((id, index) => {
      const result = results[index];
      const response = result.status === "fulfilled" ? result.value : undefined;
      return [
        id,
        response?.labels
          ? Object.fromEntries(
              response.labels
                .filter((label) => label.type === "user")
                .map((label) => [
                  label.id || "",
                  {
                    id: label.id || "",
                    name: label.name || "",
                    type: label.type || null,
                    color: label.color,
                    labelListVisibility: label.labelListVisibility,
                    messageListVisibility: label.messageListVisibility,
                  },
                ]),
            )
          : (previous[id] ?? {}),
      ];
    }),
  );
}
