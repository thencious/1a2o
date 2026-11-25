import { redirect } from "next/navigation";
import { env } from "@/env";
import { auth } from "@/utils/auth";
import prisma from "@/utils/prisma";
import {
  hasGoogleOauthConfig,
  hasMicrosoftOauthConfig,
} from "@/utils/oauth/provider-config";
import { AccountsContent } from "./AccountsContent";

export default async function AccountsPage() {
  if (!env.NEXT_PUBLIC_BYPASS_PREMIUM_CHECKS) return <AccountsContent />;

  const session = await auth();
  if (!session?.user) redirect("/login");
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { completedOnboardingAt: true },
  });
  if (!user) redirect("/logout");
  if (user.completedOnboardingAt) return <AccountsContent />;

  const mailboxes = await prisma.emailAccount.findMany({
    where: { userId: session.user.id },
    select: {
      id: true,
      calendarConnections: {
        where: { isConnected: true },
        select: { email: true, provider: true },
      },
    },
  });
  if (!mailboxes.length) redirect("/connect-mailbox?next=%2Faccounts");

  return (
    <AccountsContent
      onboarding={{
        enabledProviders: [
          ...(hasGoogleOauthConfig() ? (["google"] as const) : []),
          ...(hasMicrosoftOauthConfig() ? (["microsoft"] as const) : []),
        ],
        calendarConnections: mailboxes.flatMap((mailbox) =>
          mailbox.calendarConnections.map(({ email, provider }) => ({
            mailboxId: mailbox.id,
            email,
            provider,
          })),
        ),
        beeperAvailable:
          env.LOCAL_BEEPER_ENABLED === "true" &&
          env.LOCAL_BEEPER_OWNER_ID === session.user.id,
        contactsEnabled: env.NEXT_PUBLIC_CONTACTS_ENABLED,
      }}
    />
  );
}
