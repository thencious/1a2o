import { TZDate } from "@date-fns/tz";
import { SafeError } from "@/utils/error";

export function resolveMessageSendTime(
  local: string,
  timezone: string,
  now = new Date(),
) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) throw new SafeError("Choose a date and time for the message.");
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  new Intl.DateTimeFormat("en", { timeZone: timezone });
  const zoned = new TZDate(year, month - 1, day, hour, minute, timezone);
  if (
    zoned.getFullYear() !== year ||
    zoned.getMonth() !== month - 1 ||
    zoned.getDate() !== day ||
    zoned.getHours() !== hour ||
    zoned.getMinutes() !== minute
  ) {
    throw new SafeError("That date or time does not exist in your time zone.");
  }
  if (zoned.getTime() <= now.getTime())
    throw new SafeError("Choose a future time for the message.");
  return new Date(zoned.getTime());
}
