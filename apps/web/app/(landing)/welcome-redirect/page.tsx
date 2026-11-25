import { redirect } from "next/navigation";
import { auth } from "@/utils/auth";
import prisma from "@/utils/prisma";
import { redirectToEmailAccountPath } from "@/utils/account";
import { isPremiumRecord, premiumEntitlementSelect } from "@/utils/premium";
import { env } from "@/env";

export default async function WelcomeRedirectPage(props: {
  searchParams: Promise<{ force?: boolean; mode?: string }>;
}) {
  const searchParams = await props.searchParams;
  const session = await auth();

  if (!session?.user) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      completedOnboardingAt: true,
      signupIntent: true,
      premiumId: true,
    },
  });

  // Session exists but user doesn't - invalid state, log out
  if (!user) redirect("/logout");
  if (searchParams.force) redirect("/onboarding");
  if (env.NEXT_PUBLIC_BYPASS_PREMIUM_CHECKS) {
    if (!user.completedOnboardingAt) redirect("/accounts");
    await redirectToEmailAccountPath("/mail", {
      accountScope: "all",
      split: "all",
    });
  }
  if (user.completedOnboardingAt) {
    // Opening the email app from an AI-assistant account means they now use
    // both.
    if (
      searchParams.mode === "mail" &&
      (!user.signupIntent || user.signupIntent === "AI_ASSISTANT")
    ) {
      await prisma.user.update({
        where: { id: session.user.id },
        data: { signupIntent: "BOTH" },
      });
    }

    await redirectToEmailAccountPath(
      searchParams.mode === "mail" || user.signupIntent === "MAIL_CLIENT"
        ? "/mail"
        : "/automation",
    );
  }

  if (user.premiumId) {
    const premium = await prisma.premium.findUnique({
      where: { id: user.premiumId },
      select: premiumEntitlementSelect,
    });

    if (isPremiumRecord(premium)) {
      await redirectToEmailAccountPath("/setup");
    }
  }

  redirect("/onboarding");
}
