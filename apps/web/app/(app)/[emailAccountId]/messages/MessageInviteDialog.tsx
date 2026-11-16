"use client";
import useSWR, { useSWRConfig } from "swr";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toastSuccess } from "@/components/Toast";
import { MonthEventEditor } from "../calendars/MonthEventEditor";
import type { MonthCalendar } from "@/utils/calendar/month-types";
import type { PreparedMessageInvite } from "@/utils/messages/invite";

export function MessageInviteDialog({
  proposal,
  onClose,
}: {
  proposal: PreparedMessageInvite;
  onClose: () => void;
}) {
  const { mutate: mutateAll } = useSWRConfig();
  const { data, error, mutate } = useSWR<{ calendars: MonthCalendar[] }>(
    "/api/user/calendar/catalog",
  );
  if (!data?.calendars.some((calendar) => calendar.writable))
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DialogContent>
          <DialogTitle>Meeting invitation</DialogTitle>
          <DialogDescription>
            {error
              ? "Could not load calendars. Your invitation has not been sent."
              : data
                ? "Connect a calendar with editing permission in Settings → Calendars to send this invitation."
                : "Loading your calendars…"}
          </DialogDescription>
          {error && <Button onClick={() => mutate()}>Retry</Button>}
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogContent>
      </Dialog>
    );
  return (
    <MonthEventEditor
      calendars={data.calendars}
      day={proposal.start ? new Date(proposal.start) : new Date()}
      draft={proposal}
      onClose={onClose}
      onCopy={() => {}}
      onSaved={() => {
        onClose();
        toastSuccess({
          description:
            "Calendar invitation created and sent to the listed guests.",
        });
        mutateAll((key) =>
          Boolean(
            key &&
              typeof key === "object" &&
              "url" in key &&
              typeof key.url === "string" &&
              key.url.startsWith("/api/user/calendar/month"),
          ),
        );
      }}
    />
  );
}
