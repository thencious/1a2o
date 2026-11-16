import { retainWorkspacePage } from "@/components/retain-workspace-page";
import { AgentsWorkspace } from "./AgentsWorkspace";
function AgentsPage() {
  return <AgentsWorkspace />;
}

export default retainWorkspacePage(AgentsPage);
