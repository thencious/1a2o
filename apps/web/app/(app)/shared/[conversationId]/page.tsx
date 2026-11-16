import { retainWorkspacePage } from "@/components/retain-workspace-page";
import { SharedConversationReader } from "@/app/(app)/shared/[conversationId]/SharedConversationReader";

async function SharedConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  return <SharedConversationReader conversationId={conversationId} />;
}

export default retainWorkspacePage(SharedConversationPage);
