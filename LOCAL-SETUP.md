# 1a2o: local OpenRouter setup

This guide configures the 1a2o local backend and optional OpenRouter gateway.
Use the upstream hosting guides for Docker, Linux, macOS, or a cloud deployment.
The portable runner and desktop launcher documented here target Windows x64.
No credentials, installed tools, mailbox databases, or generated executables are
shipped in this repository.

## Calendar view

The Calendars page includes a unified month view across all connected Google and
Outlook calendar accounts. Only active calendars receive colors, starting with
red, yellow, blue, green, and purple before using additional distinct accents.
The same colors appear in month events, the day timeline, and settings.
Archived calendars remain uncolored; changing the active selection redistributes
the palette across the calendars in use.
Archive or restore calendars using the visibility
checklist in User → Settings → Calendars. Click a
day to open its timeline, or use the + control to create an event, or click an event to view or edit it. The event editor
remembers the last calendar used for new events. Shared calendars are shown once;
read-only calendars remain viewable. Recurring-event edits affect one occurrence.
Mailbox-specific connections and scheduling settings are in User → Settings →
Calendars. Select the mailbox there to manage its connections and scheduling.
Use **Enable editing** on an existing connection to reopen Google or Microsoft
consent for that calendar account. Approve event editing to upgrade the connection;
declining write access keeps the existing connection. Subscription calendars and
calendars shared without editor access remain read-only.
Google events generated automatically from Gmail have protected event details.
Use **Create editable copy** for a normal event with editable title, time, and
notes; the original is kept and guests are not copied. **Delete** remains available
for events in writable calendars, including Gmail-generated events and unwanted
invitations, and requires confirmation.

## Prerequisites

Install Git for Windows and prepare the following sibling directory layout.
The paths are resolved relative to the checkout; no particular Windows username
or clone location is required.

```text
workspace/
  1a2o/                                   # this checkout
  tools/
    node-v24.22.1-win-x64/node.exe
    pnpm/node_modules/pnpm/bin/pnpm.cjs     # pnpm 11.19.0
    postgresql16/pgsql/bin/                 # PostgreSQL 16 binaries
    garnet/net10.0/GarnetServer.exe         # Redis-compatible Garnet server
```

Use official [Node.js](https://nodejs.org/), [pnpm](https://pnpm.io/),
[PostgreSQL](https://www.postgresql.org/download/windows/), and
[Garnet](https://github.com/microsoft/garnet) distributions. Garnet may also need
the matching .NET runtime. Chrome or Edge and the Windows .NET Framework C#
compiler are required only for the desktop launcher.

Install workspace dependencies using the pnpm version in `package.json`, then
copy `apps/web/.env.example` to `apps/web/.env.local`. Follow the upstream hosting
instructions to fill required settings. In particular:

- Set `NEXT_PUBLIC_BASE_URL=http://localhost:3000`.
- Point `DATABASE_URL` at your own local PostgreSQL database on port 5433.
- Set `REDIS_URL=redis://127.0.0.1:6380` and
  `REDIS_HTTP_URL=http://127.0.0.1:8079`; generate a private `REDIS_HTTP_TOKEN`.
- Generate independent `AUTH_SECRET`, `INTERNAL_API_KEY`, `EMAIL_ENCRYPT_SECRET`,
  and `EMAIL_ENCRYPT_SALT` values. Preserve the encryption values with the database.
- Enter your own Google and/or Microsoft OAuth credentials. Placeholder values
  can permit compilation but cannot connect a mailbox.

Initialize `.context/postgres` using `initdb.exe` with SCRAM authentication and
its interactive password prompt. Start that instance with `pg_ctl.exe` on
`127.0.0.1:5433`, then create the database named in `DATABASE_URL`. A fresh clone
must initialize this data directory before using the portable runner.

Ports 3000 (app), 3010 (quota gateway), 5433 (PostgreSQL), 6380 (Garnet), and
8079 (Redis HTTP bridge) must be free. The runner binds services to loopback.
Do not point another app at port 3000; the desktop launcher checks app readiness
and reports a conflicting server instead of treating it as 1a2o.

## Configure OpenRouter

Put your own API key in `apps/web/.env.local`. This example selects OpenRouter's
free-model router; choose a currently available model that supports structured
output and tool calling if you prefer a fixed model.

```dotenv
OPENROUTER_API_KEY=replace-with-your-own-key
OPENROUTER_BASE_URL=http://127.0.0.1:3010/api/v1
OPENROUTER_REQUESTS_PER_MINUTE=20
OPENROUTER_REQUESTS_PER_DAY=50
OPENROUTER_FREE_ONLY=true
DEFAULT_LLMS=openrouter:openrouter/free
ECONOMY_LLMS=openrouter:openrouter/free
NANO_LLMS=openrouter:openrouter/free
CHAT_LLMS=openrouter:openrouter/free
DRAFT_LLMS=openrouter:openrouter/free
```

The gateway defaults to 20 forwarded attempts/minute and 50/day. OpenRouter
currently documents a 1,000/day allowance for free models after qualifying
credit purchases; verify your own allowance before setting
`OPENROUTER_REQUESTS_PER_DAY=1000`. See [OpenRouter pricing and limits](https://openrouter.ai/pricing).
These variables limit this installation; they do not upgrade a provider account.
Paid models are blocked while free-only mode is enabled.

At a 1,000/day setting, backlog work can use at most 900 requests and 100 are
protected for new mail and interactive use. At 50/day, all 50 are protected, so
bulk backfill waits. Minute/day usage survives restarts in SQLite. A completed
batch of 20 attempts is followed by a full 60-second cooldown. Failed attempts
and retries count. The day resets at the absolute boundary 00:00 UTC.

Only requests routed through this gateway are covered by its local counter.
Account-level AI-provider overrides and other applications using the same key
must be accounted for separately; OpenRouter remains authoritative. Upstream
usage is imported when its API reports a usable free-request count.

## Connect Gmail and optional Calendar

1. Create your own Google Cloud project and enable Gmail API.
2. For personal Gmail, configure an External OAuth consent application and add
   the mailbox owner as a test user while the consent app is in testing.
3. Follow [the upstream Google OAuth guide](docs/hosting/google-oauth.mdx) for scopes.
4. Create a Web application client with origin `http://localhost:3000` and
   register these exact callbacks:
   - `http://localhost:3000/api/auth/callback/google`
   - `http://localhost:3000/api/google/linking/callback`
5. Download its JSON and run **Configure Gmail.cmd** with the private file path.

For optional Calendar linking, enable the Calendar API and required consent
scopes, and set:

```dotenv
GOOGLE_CALENDAR_REDIRECT_URI=http://localhost:3000/api/google/linking/callback
```

Signed Calendar state is dispatched to the Calendar handler; browser-cookie and
account-ownership checks remain in place. Start a fresh Connect Calendar flow
after changing callbacks. Drive and other optional integrations need their own
provider setup. See [OUTLOOK-SETUP.md](OUTLOOK-SETUP.md) for Microsoft accounts.

## Build and run

From the checkout, run **Build 1a2o.cmd**, then **Start 1a2o.cmd**.
The build deploys database migrations before building the production app.
Open `http://localhost:3000/mail?accountScope=all&split=all` and connect mailboxes.
Use **Stop 1a2o.cmd** to stop this installation's services.

Starting the local runner with an OpenRouter key starts automation for connected
mailboxes. Its setup enables standard tagging and reply-draft rules. Bulk
processing applies labels only; recent-mail processing permits labels and saved
drafts. It filters out automatic send and archive actions in this local AI path.
Review mailbox rules before starting it if you need different behavior.

For a desktop app icon, run the installer from PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/local-openrouter/install-windows.ps1
```

It compiles the launcher, derives an icon from the repository's 1a2o logo,
and creates Desktop/Start-menu shortcuts. Existing private launcher configuration
is preserved. Pin the Start-menu shortcut to the taskbar using Windows.
Add `-EnableStartup` if you want background services started at Windows sign-in.
Use `-ValidateOnly` to compile a separate validation binary/icon without changing
configuration or shortcuts. Generated files live under ignored `.context/desktop/`.

The launcher reuses healthy services or starts them, waits for the mail server
and both workers, and opens the combined inbox. Closing the browser/app window
leaves services running. The independent scheduled-mail worker checks Send later,
reminders, and snoozes every 15 seconds, even when the AI allowance is exhausted.
The runner generates a private `CRON_SECRET` on first start if one is absent.

## Background behavior and data

- Each mailbox is checked for arrivals every five seconds without a public
  webhook tunnel. This is polling, not provider push delivery.
- Up to four backlog jobs leave two execution slots available for recent mail.
- Each bulk AI call classifies up to ten emails independently. At 900 full
  batches, the theoretical maximum is 9,000 older emails/day; retries, partial
  batches, and other usage reduce that figure.
- New mail uses the native rule/draft pipeline and can require multiple AI calls.
  A reserve of 100 calls does not guarantee processing 100 messages.
- Decisions are saved before labels are written. Provider write failures can
  retry those decisions without another classification call.
- A persisted arrival cutoff distinguishes backlog from new mail, including mail
  that arrived while the machine was off. Discovery continues after the bulk
  allowance is exhausted. Processing resumes at the next UTC reset/startup.
- PostgreSQL draft-creation receipts recover confirmed provider IDs after a lost
  client response. Genuinely ambiguous writes are reconciled conservatively;
  sending remains deduplicated by the durable outbox.
- Initial mailbox catch-up is quota-aware and can take time for large mailboxes.
  Model latency and provider limits also affect classification speed.

AI processing sends selected email content to OpenRouter and its model provider.
Keep keys and OAuth credential files out of Git and review provider data policies
for your use case. `.env.local` and `.context/` are ignored.

| Local path | Purpose |
| --- | --- |
| `.context/postgres/` | Persistent mailbox/application database |
| `.context/openrouter/` | Persistent AI quota counters |
| `.context/local-ai/queue.sqlite` | Durable discovery/classification queue |
| `.context/local-ai/status.json` | AI progress and next reset |
| `.context/mail-jobs-status.json` | Scheduled-mail worker health |
| `.context/desktop/launcher.log` | Desktop readiness/startup log |
| `.context/logs/` | Private runtime logs |

`http://127.0.0.1:3010/health` exposes quota counts without credentials or email.
Back up the database and encryption configuration together. The Redis-compatible
cache is disposable. Changes to `NEXT_PUBLIC_*` settings require a rebuild.

## Unified messages

**Messages** stays in the main sidebar. **Rules** and the original **Channels**
email-to-chat delivery settings are under **Tools**, collapsed by default.

The **Messages** sidebar page uses a compact conversation list and resizable
thread preview, combining WhatsApp, WeChat, Discord direct messages, and
Google Messages SMS/RCS. Each conversation appears once with its latest message;
group conversations open in the same preview. Account/unread filters, arrow-key
navigation, older history, replies, and media previews/downloads are included.
Replies can include one attachment up to 17 MB. Provider limits still apply.

Install and run Beeper Desktop, sign in, and link the messaging accounts there.
Enable its Desktop API under Settings → Integrations and create an approved
connection token. Open **Messages → Settings** in 1a2o and paste the
token. It is validated against the fixed loopback API and stored encrypted under
ignored `.context/beeper/`. Set `LOCAL_BEEPER_ENABLED=true` and
`LOCAL_BEEPER_OWNER_ID` to the authorized local app user. Other app users cannot
access this installation's chats or connection token.

Discord server channels are excluded. Beeper's public API exposes server channels
and private group DMs under the same group type, so Discord groups are excluded
by default. Under Messages settings, explicitly select only private group DMs to
include. Ordinary WhatsApp, WeChat, and SMS groups need no manual approval.

The app polls conversations every five seconds and the open thread every 2.5
seconds. Draft text stays in this browser when switching threads or reloading.
Message submissions use durable receipts and disable automatic request retries
to prevent duplicate sends after an uncertain network response. Media access is
checked against an authorized conversation and its actual attachment records.
Beeper must remain running; some networks route through Beeper Cloud according
to the connection type chosen there. No messaging accounts are linked by merely
enabling this feature.

In Messages settings, Startup and recovery can save an existing Beeper recovery key once. The key is encrypted locally and never returned to the browser. Saving verifies it against the currently signed-in Beeper account; later unverified sessions for that account can be recovered through Beeper's documented local API. The background service starts the installed Beeper Desktop app when needed, without passing mailbox/provider credentials to it. Repeated failed key attempts stop until an explicit retry or key change.

Recovery verifies encrypted messaging after sign-in. It does not replace email-code sign-in, renew a rejected Desktop API token, or reset encryption keys. Keep an independent backup of the recovery key; the local encrypted copy depends on this installation's encryption configuration.


## Local Codex agents

The **Agents** sidebar page opens real Codex CLI terminals. **Add agent** opens
a searchable conversation picker with full titles, folders, and models.
**New chat** is the first option, with a slightly brighter neutral background.
Opening the picker prepares a fresh CLI immediately. Selecting **New chat**
reuses it. Selecting an existing conversation reuses the panel and resumes
that chat; closing the picker removes the unused fresh CLI.
Panels use up to four columns and
continue on another row as more are added. The terminal accepts native CLI
shortcuts and slash commands, including modified arrow keys. Settings and the
message input start collapsed directly beneath each panel's title bar. Click
the clock to the left of its connection status to expand or collapse them.
The input sends immediately; Shift+Enter adds a line. Model, thinking level,
and working folder controls apply to messages sent through that input.

Timers are optional. Opening the controls initializes a timer at the actual
Codex five-hour reset plus one minute unless a task already exists. Enter a
custom `h:mm` delay to change it. Collapsing the controls leaves an existing
timer running; use Stop to cancel it. The deadline is an absolute timestamp.
Pause/resume, stop, and send-now controls are available. Panels and
timers persist in `.context/agents/`, and closing the app window leaves the
local broker and deadlines running. Overdue tasks resume when services start.

Enable this local feature with `LOCAL_AGENTS_ENABLED=true` and set
`LOCAL_AGENTS_OWNER_ID` to the authorized application's user ID.
`LOCAL_AGENTS_TIMER_ROOT` must point to the existing Codex Task Timer source
directory containing `core.py`, `shared_codex.py`, and `rate_limits.py`.
`LOCAL_AGENTS_CODEX_PATH` and `LOCAL_AGENTS_PYTHON` select the installed Codex
CLI and Python executables. These are server-only settings. The broker binds
to loopback port 3011; authenticated app actions and one-use terminal tickets
mediate access without exposing the internal API key.

Managed terminals connect to Codex's shared server. Messages can also reach
closed chats and externally opened legacy CLI chats through the existing
timer's delivery mechanisms and Codex's durable queue. A legacy CLI that owns
its own terminal may need to be closed before its interactive terminal can be
opened here. This integration was verified with Codex CLI 0.166.0; see the
[CLI reference](https://learn.chatgpt.com/docs/cli/reference) and
[app-server documentation](https://learn.chatgpt.com/docs/app-server).

## Message and calendar labeling rules

Tools → Rules separates Mail, Messages, and Calendars above the Rules, Test,
History, and Settings tabs. Mail keeps its existing email automation. Messages
starts with editable Business, Casual, Notification, and Other rules. Use New rule
to describe a condition and configure its Label as action. Rules are evaluated
in priority order; the first match supplies the label. Custom labels are supported.
Calendar rules start empty and apply labels displayed locally on calendar events;
they do not edit provider events or change calendar permissions.

Conversation labels refresh automatically while the app runs, including when
another section is open. Matching uses up to ten items per OpenRouter request
through the same quota gateway as Mail. Unchanged items reuse encrypted saved
results; failures back off and retry. Rules, labels, and recent match history
are stored encrypted under the ignored `.context/automation` directory and are
restricted to the configured local owner. Pausing rules preserves existing labels.

## Verification

Gateway, queue, and scheduler-worker tests use synthetic data and no mailbox:

```powershell
..\tools\node-v24.22.1-win-x64\node.exe --test scripts/local-openrouter/gateway.test.mjs scripts/local-openrouter/queue.test.mjs scripts/local-openrouter/mail-jobs.test.mjs
```

The optional `scripts/local-openrouter/smoke.mjs` test uses one real AI call.
`apps/web/scripts/local-openrouter-smoke.ts` checks structured output and tools
with synthetic content and uses two real calls. Neither accesses a mailbox.
Focused app tests cover bulk assignments, draft receipts, callback state,
recipient parsing, split selection, keyboard navigation, and provider behavior.
Browser tests include a lost-creation-response recovery case and attachment placement.
To cap older-mail tagging at 500 calls/day with a 1,000-call total budget, set
`OPENROUTER_NEW_MAIL_RESERVE=500` in `apps/web/.env.local` and restart the gateway.
This leaves 500 calls for new mail and interactive use. Existing daily counters
are preserved; the next reset remains 00:00 UTC. The reserve defaults to 100
and is clamped to the total daily allowance.


## ChatGPT sign-in and app-wide Chat tools

Chat includes **Continue with ChatGPT** for the owner of a local installation.
It uses OpenAI's public-client registration flow, PKCE, one-time state, and a
signed/verified ID token. No API key or partner client secret is required for the
open-source local flow. The callback is `http://127.0.0.1:<app-port>/auth/callback`;
complete sign-in on the same computer running 1a2o. Issued client registration,
host identity and encrypted credentials persist across restarts. Tokens never go
into browser storage, source control or chat tool results. Sign-out attempts
remote session revocation and reports if that could not be confirmed.

After connection, select an account-available model in Chat. Chat uses the public
Responses API with streaming and `store=false`, retaining 1a2o's tools and local
chat history. **Use OpenRouter** switches only Chat back to its existing provider.
Background classification, task analysis, `/add`, `/invite` and automatic
compaction keep their existing OpenRouter routing and quota. ChatGPT inference
uses the account's applicable plan access/limits; availability is checked against
the account's model catalog and errors are shown without silent provider fallback.

Chat also exposes `discover1a2oTools` and `run1a2oTool` for app-wide capabilities:
owned-mailbox reads, messages/replies/reactions/recall/forwarding, unified contacts,
calendar events and settings, Tasks and Notes, their transfers and calendar sync,
message/calendar/task rules, agent panels and schedules, and historical usage.
Discovery returns per-domain schemas, and execution reuses the app's service
validation, user ownership, optimistic revisions, idempotent sends and provider
permissions. The existing email confirmation cards remain in place. Message
sending, invitations, deletes and CLI dispatch require concrete user intent;
retrieved content is data, not instructions or permission. Credentials and
arbitrary operating-system access are excluded. Completed writes refresh affected
cached views and notify retained Task/Note frames to reconcile server changes.

Official integration references:
- https://developers.openai.com/siwc/token-sharing-open-source/sign-in
- https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
