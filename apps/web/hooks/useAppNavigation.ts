"use client";
import { useWorkspaceNavigation } from "@/components/WorkspaceRetention";
import { useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  ArchiveIcon,
  BarChartBigIcon,
  BrushIcon,
  CalendarIcon,
  ContactRoundIcon,
  ListChecksIcon,
  TerminalSquareIcon,
  FileTextIcon,
  HardDriveIcon,
  MailIcon,
  MailsIcon,
  MessagesSquareIcon,
  MicIcon,
  SparklesIcon,
  Users2Icon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";
import {
  useCleanerEnabled,
  useIntegrationsEnabled,
  useMeetingBriefsEnabled,
  useMeetingRecorderEnabled,
} from "@/hooks/useFeatureFlags";
import { useAccount } from "@/providers/EmailAccountProvider";
import { prefixPath } from "@/utils/path";
import { isGoogleProvider } from "@/utils/email/provider-types";
import { env } from "@/env";
import { TEAM_HREF, useTeamNav } from "@/components/team-comments/use-team-nav";
type NavItem = {
  name: string;
  href: string;
  icon: LucideIcon | (() => React.ReactNode);
  target?: "_blank";
  count?: number;
  hideInMail?: boolean;
  active?: boolean;
  beta?: boolean;
  new?: boolean;
};

export const useNavigation = () => {
  const rememberedHref = useWorkspaceNavigation();
  const showCleaner = useCleanerEnabled();
  const showMeetingBriefs = useMeetingBriefsEnabled();
  const showMeetingRecorder = useMeetingRecorderEnabled();
  const showIntegrations = useIntegrationsEnabled();
  const { hasTeam, unreadCount: teamUnreadCount } = useTeamNav();

  const { emailAccount, emailAccountId, provider } = useAccount();
  const currentEmailAccountId = emailAccount?.id || emailAccountId;

  const manageItems: (NavItem & { id: string })[] = useMemo(
    () => [
      {
        name: "Mail",
        id: "mail",
        href: prefixPath(
          currentEmailAccountId,
          "/mail?accountScope=all&split=all",
        ),
        icon: MailIcon,
      },
      {
        name: "Messages",
        id: "messages",
        href: prefixPath(currentEmailAccountId, "/messages"),
        icon: MessagesSquareIcon,
      },
      {
        name: "Contacts",
        id: "contacts",
        href: prefixPath(currentEmailAccountId, "/contacts"),
        icon: ContactRoundIcon,
      },
      {
        name: "Calendars",
        id: "calendars",
        href: prefixPath(currentEmailAccountId, "/calendars"),
        icon: CalendarIcon,
      },
      {
        name: "Tasks",
        id: "todo",
        href: prefixPath(currentEmailAccountId, "/todo"),
        icon: ListChecksIcon,
      },
      {
        name: "Notes",
        id: "notes",
        href: prefixPath(currentEmailAccountId, "/notes"),
        icon: FileTextIcon,
      },
      {
        name: "Agents",
        id: "agents",
        href: prefixPath(currentEmailAccountId, "/agents"),
        icon: TerminalSquareIcon,
      },
      ...(showMeetingRecorder
        ? [
            {
              name: "Meetings",
              id: "meetings",
              href: prefixPath(currentEmailAccountId, "/meetings"),
              icon: MicIcon,
            },
          ]
        : []),
    ],
    [currentEmailAccountId, showMeetingRecorder],
  );

  const cleanupItems: NavItem[] = useMemo(
    () => [
      {
        name: "Bulk Unsubscribe",
        href: prefixPath(currentEmailAccountId, "/bulk-unsubscribe"),
        icon: MailsIcon,
      },
      {
        name: "Bulk Archive",
        href: prefixPath(currentEmailAccountId, "/bulk-archive"),
        icon: ArchiveIcon,
      },
      {
        name: "Analytics",
        href: prefixPath(currentEmailAccountId, "/stats"),
        icon: BarChartBigIcon,
      },
      ...(isGoogleProvider(provider) && showCleaner
        ? [
            {
              name: "Deep Clean",
              href: prefixPath(currentEmailAccountId, "/clean"),
              icon: BrushIcon,
              beta: true,
            },
          ]
        : []),
    ],
    [currentEmailAccountId, provider, showCleaner],
  );

  const moreItems: NavItem[] = useMemo(
    () => [
      {
        name: "Rules",
        href: prefixPath(currentEmailAccountId, "/automation"),
        icon: SparklesIcon,
      },
      {
        name: "Usage",
        href: prefixPath(currentEmailAccountId, "/usage"),
        icon: BarChartBigIcon,
      },
      {
        name: "Channels",
        href: prefixPath(currentEmailAccountId, "/channels"),
        icon: MessagesSquareIcon,
      },
      ...(showMeetingBriefs
        ? [
            {
              name: "Meeting Briefs",
              href: prefixPath(currentEmailAccountId, "/briefs"),
              icon: FileTextIcon,
            },
          ]
        : []),
      ...(env.NEXT_PUBLIC_SMART_FILING_ENABLED === false
        ? []
        : [
            {
              name: "Attachments",
              href: prefixPath(currentEmailAccountId, "/drive"),
              icon: HardDriveIcon,
              new: false,
            },
          ]),
      ...(showIntegrations
        ? [
            {
              name: "Integrations",
              href: prefixPath(currentEmailAccountId, "/integrations"),
              icon: ZapIcon,
            },
          ]
        : []),
      ...(hasTeam
        ? [
            {
              name: "Discussions",
              href: TEAM_HREF,
              icon: Users2Icon,
              count: teamUnreadCount ?? undefined,
            },
          ]
        : []),
    ],
    [
      currentEmailAccountId,
      showMeetingBriefs,
      showIntegrations,
      hasTeam,
      teamUnreadCount,
    ],
  );

  const searchParams = useSearchParams();
  const pathname = usePathname();
  const scope =
    searchParams.get("accountScope") === "all" ||
    (!pathname.includes("/mail") &&
      searchParams.get("accountScope") !== "single")
      ? "all"
      : "single";
  const scopedItems = <T extends NavItem>(items: T[]) =>
    items.map((item) => {
      if (item.name === "Mail") return item;
      const separator = item.href.includes("?") ? "&" : "?";
      return { ...item, href: `${item.href + separator}accountScope=${scope}` };
    });
  return {
    emailAccountId: currentEmailAccountId,
    manageItems: scopedItems(manageItems).map((item) => ({
      ...item,
      href: rememberedHref(item.href),
    })),
    moreItems: scopedItems([...moreItems, ...cleanupItems]).map((item) => ({
      ...item,
      href: rememberedHref(item.href),
    })),
  };
};
