import type {
  ChatCapabilities,
  Message,
} from "@beeper/desktop-api/resources/shared";

export function messageActionCapabilities(
  message: Pick<
    Message,
    | "isSender"
    | "isDeleted"
    | "sendStatus"
    | "timestamp"
    | "text"
    | "attachments"
    | "isHidden"
  >,
  capabilities?: ChatCapabilities,
  readOnly = false,
  now = Date.now(),
) {
  const ready =
    !readOnly &&
    !message.isDeleted &&
    message.sendStatus?.status !== "PENDING" &&
    !message.sendStatus?.status.startsWith("FAIL");
  const maxAge = capabilities?.deleteMaxAge;
  const age = (now - Date.parse(message.timestamp)) / 1000;
  return {
    canEdit: Boolean(
      ready &&
        !message.isHidden &&
        message.isSender &&
        message.text?.trim() &&
        !message.attachments?.length &&
        (capabilities?.edit ?? 0) > 0 &&
        (capabilities?.editMaxCount === undefined ||
          capabilities.editMaxCount > 0) &&
        (capabilities?.editMaxAge === undefined ||
          (Number.isFinite(age) && age >= 0 && age <= capabilities.editMaxAge)),
    ),
    canReply: Boolean(ready && (capabilities?.reply ?? 0) > 0),
    canReact: Boolean(
      ready &&
        (capabilities?.reaction ?? 0) > 0 &&
        capabilities?.allowedReactions?.length !== 0,
    ),
    canRecall: Boolean(
      ready &&
        message.isSender &&
        (capabilities?.delete ?? 0) > 0 &&
        (maxAge === undefined ||
          (Number.isFinite(age) && age >= 0 && age <= maxAge)),
    ),
  };
}
