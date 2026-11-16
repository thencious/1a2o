import { retainWorkspacePage } from "@/components/retain-workspace-page";
import { PermissionsCheck } from "@/app/(app)/[emailAccountId]/PermissionsCheck";
import { Stats } from "./Stats";

async function StatsPage() {
  return (
    <>
      <PermissionsCheck />
      <Stats />
    </>
  );
}

export default retainWorkspacePage(StatsPage);
