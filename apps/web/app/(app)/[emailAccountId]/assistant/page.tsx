import { retainWorkspacePage } from "@/components/retain-workspace-page";
import { Suspense } from "react";
import { PermissionsCheck } from "@/app/(app)/[emailAccountId]/PermissionsCheck";
import { EmailLabelsProvider } from "@/providers/EmailLabelsProvider";
import { Chat } from "@/components/assistant-chat/chat";
import { checkUserOwnsEmailAccount } from "@/utils/email-account";

export const maxDuration = 300; // Applies to the actions

async function AssistantPage({
  params,
}: {
  params: Promise<{ emailAccountId: string }>;
}) {
  const { emailAccountId } = await params;
  await checkUserOwnsEmailAccount({ emailAccountId });

  return (
    <EmailLabelsProvider>
      <Suspense>
        <PermissionsCheck />

        <div className="flex min-h-0 flex-1 flex-col">
          <Chat open />
        </div>
      </Suspense>
    </EmailLabelsProvider>
  );
}

export default retainWorkspacePage(AssistantPage);
