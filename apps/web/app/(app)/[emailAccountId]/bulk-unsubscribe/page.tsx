import { retainWorkspacePage } from "@/components/retain-workspace-page";
import { PermissionsCheck } from "@/app/(app)/[emailAccountId]/PermissionsCheck";
import { BulkUnsubscribe } from "./BulkUnsubscribeSection";

export const maxDuration = 180;

async function BulkUnsubscribePage() {
  return (
    <>
      <PermissionsCheck />
      <BulkUnsubscribe />
    </>
  );
}

export default retainWorkspacePage(BulkUnsubscribePage);
