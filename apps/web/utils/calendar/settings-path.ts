export function calendarSettingsPath(emailAccountId?: string) {
  return `/settings${emailAccountId ? `?calendarAccount=${encodeURIComponent(emailAccountId)}` : ""}#calendar-settings`;
}
