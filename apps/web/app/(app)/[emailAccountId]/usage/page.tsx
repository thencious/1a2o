import { retainWorkspacePage } from "@/components/retain-workspace-page";
import { UsageDashboard } from "./UsageDashboard";

function UsagePage() {
  return <UsageDashboard />;
}

export default retainWorkspacePage(UsagePage);
