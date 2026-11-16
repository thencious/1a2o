import { retainWorkspacePage } from "@/components/retain-workspace-page";
import { PageWrapper } from "@/components/PageWrapper";
import { PageHeader } from "@/components/PageHeader";
import { UnifiedMonthCalendar } from "./UnifiedMonthCalendar";
import { auth } from "@/utils/auth";
import { redirect } from "next/navigation";

async function CalendarsPage() {
  const session = await auth();
  if (!session?.user.id) redirect("/login");
  return (
    <PageWrapper>
      <PageHeader title="Calendars" />
      <UnifiedMonthCalendar key={session.user.id} userId={session.user.id} />
    </PageWrapper>
  );
}

export default retainWorkspacePage(CalendarsPage);
