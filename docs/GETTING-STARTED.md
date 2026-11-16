# Getting started with 1a2o

## Choose where your data lives

1a2o needs one backend. Use your Windows computer for a personal installation, or a private HTTPS server if you need access while the computer is off. Android is a companion to that backend. Mail, calendar, AI and messaging integrations are not installed separately on each phone.

**Already have 1a2o on a computer?** Skip server setup. Install the Android APK from [Releases](https://github.com/thencious/open-inbox-zero/releases), open Settings > Android on the computer, and follow the [pairing guide](ANDROID.md). Pairing reuses existing accounts. No new Gmail, Outlook or Beeper logins are needed for the same installation.

## First server installation

Follow [LOCAL-SETUP.md](../LOCAL-SETUP.md) for the supported prerequisites, database/cache configuration and launch commands. These are self-hosting instructions, not a claim of a managed hosted service.

Connect features in this order:

1. **Connect one mailbox.** Choose Gmail or Outlook. The server administrator configures an OAuth app once; each user then signs in through their provider. For Google apps still in testing, add your account as a test user and enable the required Gmail/Calendar APIs. Use the exact callback URLs shown in the setup guide.
2. **Check Mail.** All inboxes is the default. Additional accounts can be connected from Settings. Let initial history synchronization finish; the UI can display cached results during later refreshes.
3. **Start Tasks and Notes.** Create a sample item and edit it. Local saves happen first. Cloud backup/sync status and recovery are covered in [SYNC.md](SYNC.md); retain a recovery export separately from the host computer.
4. **Connect calendars.** Settings contains calendar access, editing permissions, visibility and the default calendar. Authorize writing only if you want to edit or create events. A read-only calendar cannot make its originals editable merely by changing the app's controls.
5. **Add messaging, if wanted.** Install Beeper Desktop on the backend host, connect networks there, then approve this app's local API connection. Each platform controls which operations, contacts and receipts its bridge exposes. Keep the Beeper recovery material private and retain it outside this repository.
6. **Enable AI, if wanted.** Add your own OpenRouter key to private server configuration and choose limits matching your account. No API key is baked into Android. ChatGPT sign-in affects Chat; classification remains on the configured OpenRouter provider.
7. **Pair Android.** Open Settings > Android. For a local Windows backend, both devices should use the same trusted Wi-Fi initially. The QR/code is private, short-lived and single-use. Revoke a lost device from the same Settings section.

These integrations are optional except the initial account used by the existing web application's sign-in flow. A disabled integration should be treated as unconnected, not as a reason to paste unrelated credentials into it.

## On a phone or tablet

The first screen asks you to connect to an existing installation. It does not ask you to create another 1a2o account or sign into every messaging network again. Scan the computer's QR link or paste it, confirm the host, and connect. You can decline notifications and enable them later.

`localhost` on the phone means the phone. Use the computer's private-network address shown in Settings or your HTTPS server. Local HTTP is only for trusted private Wi-Fi; HTTPS or a private VPN is needed for safe access elsewhere. The app retains its connection after closing. Live operations need the host online; saved Tasks and Notes have a local offline path.

## If something goes wrong

- **Cannot connect:** verify the host is running, both devices can reach the shown address, and Windows Firewall permits the private-network connection. Do not expose the computer directly to the public internet.
- **Pairing expired/used:** create another code. Your existing data and mailbox connections are unchanged.
- **A device is lost:** disconnect it in Settings > Android. The corresponding server session is revoked.
- **A provider asks you to sign in again:** complete authorization in the system browser/on the host. Provider tokens can expire; the app cannot make OAuth tokens infinite.
- **Offline:** keep editing local Tasks/Notes. Do not clear browser/app storage or uninstall while there are unsynced edits. Reconnect and check sync status before moving to a different installation.
- **Restore after host loss:** follow the [recovery guide](SYNC.md) and use the private recovery export. A backup is useful only if its encryption key is retained.

## Try without personal accounts

The upstream `pnpm local:start` command starts an isolated mail-provider demo with canned AI. It is useful for development and does not connect your real accounts. It does not configure Beeper, a personal cloud-sync service or desktop CLI agents. The [gallery](FEATURES.md) demonstrates the fork's other workspaces with fictional fixtures.
