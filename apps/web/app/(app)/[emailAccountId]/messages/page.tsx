import { retainWorkspacePage } from "@/components/retain-workspace-page";
import { MessagesWorkspace } from "./MessagesWorkspace";
function MessagesPage() {
  return <MessagesWorkspace />;
}

export default retainWorkspacePage(MessagesPage);
