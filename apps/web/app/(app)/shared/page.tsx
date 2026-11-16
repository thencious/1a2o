import { retainWorkspacePage } from "@/components/retain-workspace-page";
import { PageWrapper } from "@/components/PageWrapper";
import { SharedConversationList } from "@/app/(app)/shared/SharedConversationList";
import { SharedTabs } from "@/app/(app)/shared/SharedTabs";

function SharedPage() {
  return (
    <PageWrapper>
      <SharedTabs />
      <div className="mt-6">
        <SharedConversationList />
      </div>
    </PageWrapper>
  );
}

export default retainWorkspacePage(SharedPage);
