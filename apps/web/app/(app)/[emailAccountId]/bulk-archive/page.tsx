import { retainWorkspacePage } from "@/components/retain-workspace-page";
import { PermissionsCheck } from "@/app/(app)/[emailAccountId]/PermissionsCheck";
import { BulkArchive } from "@/app/(app)/[emailAccountId]/bulk-archive/BulkArchive";

function BulkArchivePage() {
  return (
    <>
      <PermissionsCheck />
      <BulkArchive />
    </>
  );
}

export default retainWorkspacePage(BulkArchivePage);
