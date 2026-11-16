# LinkedIn connection synchronization

Open **Messages → Contacts → LinkedIn sync → Connect LinkedIn**. Sign in and
complete any verification in the LinkedIn window that opens on the desktop PC.
No developer application, API token, or paid service is required for this flow.

1a2o opens its own temporary browser context; it does not read existing browser
profiles or Beeper's LinkedIn credentials. The resulting LinkedIn session is
passed to the local server over child-process IPC, validated, and stored encrypted
per user. 1a2o does not collect the password. Disconnect deletes the saved
session and imported directory. Closing the sign-in window cancels the attempt.
The sign-in helper is available only to the configured desktop installation owner.

Connection reads use LinkedIn's web session endpoint, independently of Beeper's
conversation/contact coverage. This is an unofficial integration and may require
maintenance when LinkedIn changes its web API. Verification or expired sessions
pause synchronization and show a reconnect action.

Imports read 40 connections per page with a two-second pause between requests.
Each batch reads up to 20 pages and saves its continuation, including on rate
limits. Partial imports never replace the last complete directory. The next batch
resumes automatically, including after a restart. Successful imports repeat after
24 hours. Rate limits honor Retry-After with at least a one-hour pause; other
transient errors back off for at least 15 minutes. No AI requests are used.

The local mail-jobs service checks `/api/cron/linkedin-contacts` every minute using
`CRON_SECRET`. Hosted installations need the desktop helper on the server for the
sign-in window and an equivalent authenticated cron schedule for background sync.
Installed Edge and the existing Playwright dependency supply the sign-in window.

Raw imported connections and Beeper contacts are retained. The Contacts view
combines matching names across different apps, ignoring case, extra whitespace,
and equivalent Unicode formatting. Every original profile and distinct field is
preserved. Exact same-profile links can connect multiple sources of one profile;
distinct profiles in the same app remain separate. Ambiguous name matches with
multiple profiles in one app are not merged automatically. Profile links open
the corresponding app. This contacts integration does not send messages or invitations.

The previously available Member Portability API authorization remains supported
by the backend for an already configured connection; the normal UI now uses the
desktop sign-in flow.

Protocol references:
- https://github.com/vicnaum/linkedin-toolkit/blob/main/references/endpoints.md
- https://github.com/mautrix/linkedin/tree/main/pkg/linkedingo
