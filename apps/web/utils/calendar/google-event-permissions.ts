import type { calendar_v3 } from "@googleapis/calendar";

export function googleEventPermissions(
  event: calendar_v3.Schema$Event,
  writable: boolean,
) {
  const organizer =
    event.organizer?.self === true ||
    event.guestsCanModify === true ||
    !event.organizer?.email;
  const canManage =
    writable && !event.locked && organizer && event.status !== "cancelled";
  const regular = !event.eventType || event.eventType === "default";
  const editable = Boolean(canManage && regular);
  const deletable = writable && event.status !== "cancelled";
  let readOnlyReason: string | undefined;
  if (!editable) {
    if (event.eventType === "fromGmail")
      readOnlyReason =
        "Google created this event automatically from Gmail. Google does not let connected apps change its title, time, location, or notes. Create an editable copy to change those details; the original will stay on your calendar.";
    else if (!writable)
      readOnlyReason =
        "This calendar is read-only. Its owner controls editing access.";
    else if (!organizer)
      readOnlyReason =
        "This invitation's organizer has not allowed guests to edit it.";
    else
      readOnlyReason =
        "Google manages this special event. Create an editable copy to change its details.";
  }
  return { editable, deletable, readOnlyReason };
}
