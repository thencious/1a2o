import { retainWorkspacePage } from "@/components/retain-workspace-page";
import { PageWrapper } from "@/components/PageWrapper";
import { OrgAnalyticsConsentBanner } from "@/app/(app)/organization/[organizationId]/OrgAnalyticsConsentBanner";
import { OrgStats } from "@/app/(app)/organization/[organizationId]/stats/OrgStats";
import { OrganizationTabs } from "@/app/(app)/organization/[organizationId]/OrganizationTabs";

async function OrgStatsPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;

  return (
    <PageWrapper>
      <OrganizationTabs organizationId={organizationId} />
      <OrgAnalyticsConsentBanner />
      <div className="mt-6">
        <OrgStats organizationId={organizationId} />
      </div>
    </PageWrapper>
  );
}

export default retainWorkspacePage(OrgStatsPage);
