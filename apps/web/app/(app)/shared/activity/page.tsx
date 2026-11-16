import { retainWorkspacePage } from "@/components/retain-workspace-page";
import { PageWrapper } from "@/components/PageWrapper";
import { ConversationActivity } from "@/app/(app)/shared/activity/ConversationActivity";
import { SharedTabs } from "@/app/(app)/shared/SharedTabs";

function SharedActivityPage() {
  return (
    <PageWrapper>
      <SharedTabs />
      <div className="mt-6">
        <ConversationActivity />
      </div>
    </PageWrapper>
  );
}

export default retainWorkspacePage(SharedActivityPage);
