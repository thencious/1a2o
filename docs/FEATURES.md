# 1a2o feature gallery

These screenshots use fictional people, reserved example email addresses, sample messages, and simulated service responses. They contain no live mailbox content, contact exports, credentials, or private recovery links. The QR code is a nonfunctional demonstration link.

The gallery renders the app's current components and styles in an isolated browser harness. Mail demonstrates the shared thread rows, label chips, split tabs, and message renderer composed into a sample reader. Agents uses the real panels and scheduler with clearly synthetic terminal output. Provider connections, sends, AI requests, and scheduled deliveries are mocked; the gallery is a visual demonstration, not a claim that those operations were performed.

[README feature guide](../README.md#explore-by-tab) | [Get started](GETTING-STARTED.md)

## Mail

The Mail tab builds on [Inbox Zero](https://github.com/elie222/inbox-zero). 
Gmail and Outlook in a combined inbox, account colors, category filters, compact thread rows, and a separate reading column. The reader includes recipient addresses, reply, forward, archive, and compose controls.

![Combined mail and split reader](screenshots/mail.png)

## Messages

One conversation list across messaging networks, with app filters and Business, Casual, Notification, and Other labels. Conversations open beside the list on desktop. Supported actions such as reply, react, edit, recall, and forwarding depend on the underlying network and Beeper capabilities.

![Unified messaging](screenshots/messages.png)

## Calendars

Google and Outlook calendars together in a month view, with distinct calendar colors and visible-calendar preferences. Open a date for the single-day timeline; use the plus button to create an event. Writable calendars support editing and drag-to-move or Alt-drag-to-copy.

![Unified monthly calendar](screenshots/calendar.png)

![Single-day timeline](screenshots/calendar-day.png)

## Tasks

Overdue, Urgent, Important, and Unimportant sections, due dates, work estimates, and Markdown details. Completed tasks have their own view. Task analysis, reminder delivery, and calendar creation require configured services; these captures show saved sample results.

![Tasks and detail editor](screenshots/tasks.png)

## Notes

Obsidian-style live Markdown notes with tables, callouts, math, syntax reveal, source mode, and links between notes. Includes search, manual ordering, creation/edit dates, date filters, and an Add to tasks action. Tasks can also be copied to Notes.

![Notes and Markdown editing](screenshots/notes.png)

## Contacts

Contacts from email and supported messaging sources, including LinkedIn imports. Matching profiles can be combined while preserving their distinct email addresses, phone numbers, companies, and profile links. Network tags still find contacts with multiple profiles.

![Combined contact profiles](screenshots/contacts.png)

![Manual contact combination](screenshots/contacts-combine.png)

Ctrl-click contacts, right-click a selected row, and choose **Combine contacts**. Unique details and profile links are retained.

## Chat

An app-aware chat composer, model and thinking-level controls, account settings, attachments, and an Open in ChatGPT shortcut. The screenshot shows a draft prompt; no AI response was generated for the gallery.

![Chat controls](screenshots/chat.png)

## Agents

Reorderable agent panels with individual terminal sessions and collapsible schedulers. Each scheduled call has its own time and message. This feature is omitted from Android.

![Agent panels and scheduler with sample terminal output](screenshots/agents.png)

## Tools

### Rules

Mail, Messages, Calendars, and Tasks have separate rule areas. The Messages example shows the same rule-table pattern used for mail, including enabled switches, prompts, labels, and per-rule options.

![Messages rules](screenshots/rules.png)

### AI usage

OpenRouter usage by feature, hour, and day, with date navigation, retained history, and a detailed request log. Local rate-limit blocks are distinguished from attempts sent upstream. All numbers in this screenshot are simulated.

![AI usage and history](screenshots/usage.png)

### Bulk Unsubscribe

All inboxes and All time by default, a mailbox selector, sender counts and read rates, suggested selections, and account-specific actions. History scanning fills gaps in the indexed sender list and resumes after interruption.

![Bulk Unsubscribe across inboxes](screenshots/bulk-unsubscribe.png)

## Settings and Android

### Tasks and Notes backup

Tasks and Notes save locally first, then sync encrypted content through the configured private cloud backend. Settings shows each workspace's sync state and offers a recovery-key download. The example shows Tasks synced and Notes waiting to retry; no recovery key is embedded in the screenshot or fixtures.

![Encrypted backup status and recovery-key download](screenshots/cloud-sync.png)

### Android pairing

Pair a phone or tablet with an existing installation rather than reconnecting each account. Settings explains the host requirement, server address, one-time pairing link, expiry, and paired-device management. The Android app uses the same backend data and omits Agents.

![Android pairing settings with a nonfunctional sample QR](screenshots/android-pairing.png)

### Narrow-screen examples

These are captures of the responsive web interface at a phone-sized viewport. They are not screenshots from an Android emulator.

| Messages | Tasks | Notes |
| --- | --- | --- |
| ![Phone-sized conversation](screenshots/messages-mobile.png) | ![Phone-sized tasks](screenshots/tasks-mobile.png) | ![Phone-sized notes](screenshots/notes-mobile.png) |

## Reproduce the gallery

Install the repository dependencies and build the web app so its current generated CSS is available. The harness uses `.context/active-web-build.json` when present, otherwise `apps/web/.next`. It does not start or connect to a live backend.

```sh
node scripts/screenshots/capture.mjs
node scripts/screenshots/capture-tasks-notes.mjs
```

By default the harness launches headless Microsoft Edge. Set `SCREENSHOT_BROWSER=chrome` to use an installed Chrome channel. Pass feature names to the first command to capture a subset, for example `node scripts/screenshots/capture.mjs mail calendar messages`.

Browser requests are intercepted and external origins are blocked. Fixtures are committed under `scripts/screenshots/fixtures`. Do not replace them with production exports or copy private QA screenshots into this gallery.
