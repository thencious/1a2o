# Getting started with 1a2o

## Choose where your data lives

1a2o needs one backend. Use your Windows computer for a personal installation, or a private HTTPS server if you need access while the computer is off. Android is a companion to that backend. Mail, calendar, AI and messaging integrations are not installed separately on each phone.

**Already have 1a2o on a computer?** Skip server setup. Install the Android APK from [Releases](https://github.com/thencious/1a2o/releases), open Settings > Android on the computer, and follow the [pairing guide](ANDROID.md). Pairing reuses existing accounts. No new Gmail, Outlook or Beeper logins are needed for the same installation.

## First server installation

The host administrator follows [LOCAL-SETUP.md](../LOCAL-SETUP.md) once to provision the backend, configure Google or Microsoft OAuth and enable the provider APIs. Configure optional host services such as Beeper Desktop and OpenRouter here too. Keep API keys on the host.

## Connect your accounts

1. **Sign in with Gmail or Outlook.** Your first mailbox opens the account setup screen.
2. **Connect your other accounts.** Each Google or Microsoft approval covers mail and calendar access for that account. Approve contacts access in the same prompt to import its address book when contacts are enabled. You can also connect LinkedIn or, on a host configured for Messages, approve 1a2o in Beeper Desktop and paste its access token. You can skip optional connections and add them later.
3. **Open All inboxes.** Mail synchronization starts in the background. Connected calendars and contacts appear in their respective tabs as they sync. Tasks and Notes save locally from the first edit.

To move Tasks and Notes across devices, configure [encrypted sync](SYNC.md). To use ChatGPT in Chat, sign in from the Chat tab. Background AI uses the host's configured provider.

App changes should apply to fresh installations through shared code and defaults. Account authorization is part of onboarding. Settings and data specific to an existing installation stay with that installation.

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
