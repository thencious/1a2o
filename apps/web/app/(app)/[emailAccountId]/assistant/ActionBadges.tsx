"use client";

import { Badge } from "@/components/Badge";
import { getActionColor } from "@/components/PlanBadge";
import type { ActionType, MessagingProvider } from "@/generated/prisma/client";
import {
  getActionDisplay,
  getActionIcon,
  getVisibleActions,
} from "@/utils/action-display";

export function ActionBadges({
  actions,
  provider,
  labels,
}: {
  actions: {
    id: string;
    type: ActionType;
    label?: string | null;
    labelId?: string | null;
    folderName?: string | null;
    content?: string | null;
    to?: string | null;
    messagingChannel?: { provider: MessagingProvider } | null;
  }[];
  provider: string;
  labels: Array<{ id: string; name: string }>;
}) {
  const visibleActions = getVisibleActions(actions);

  return (
    <div className="flex gap-1 sm:gap-2 flex-wrap min-w-0 justify-start">
      {visibleActions.map((action) => {
        const Icon = getActionIcon(action.type);

        return (
          <Badge
            key={action.id}
            color={getActionColor(action.type)}
            className="w-fit sm:text-nowrap shrink-0"
          >
            <Icon className="size-3 mr-1.5 hidden sm:block" />
            {getActionDisplay(action, provider, labels)}
          </Badge>
        );
      })}
    </div>
  );
}
