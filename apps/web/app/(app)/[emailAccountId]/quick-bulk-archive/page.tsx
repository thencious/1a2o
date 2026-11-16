import { retainWorkspacePage } from "@/components/retain-workspace-page";
import { ClientOnly } from "@/components/ClientOnly";
import { PageWrapper } from "@/components/PageWrapper";
import { PageHeader } from "@/components/PageHeader";
import { PermissionsCheck } from "@/app/(app)/[emailAccountId]/PermissionsCheck";
import { BulkArchiveTab } from "@/app/(app)/[emailAccountId]/quick-bulk-archive/BulkArchiveTab";
import { EmailStatsPreloader } from "@/components/EmailStatsPreloader";

function QuickBulkArchivePage() {
  return (
    <>
      <PermissionsCheck />

      <PageWrapper>
        <PageHeader title="Quick Bulk Archive" />

        <ClientOnly>
          <EmailStatsPreloader />
          <BulkArchiveTab />
        </ClientOnly>
      </PageWrapper>
    </>
  );
}

export default retainWorkspacePage(QuickBulkArchivePage);
