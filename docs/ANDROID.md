# 1a2o for Android

The Android app connects to the same 1a2o server as your computer. Mail, Messages, Chat, Calendar, Tasks, Notes, Contacts, Rules and the cleanup/usage tools share the existing backend and accounts. Agents is intentionally desktop-only. The client uses Android System WebView to run the same application, so features and fixes are shared instead of maintaining a separate mobile implementation.

## Connect for the first time

1. Install the APK on your Android phone or tablet. Android may ask you to allow installation from the app you used to download it.
2. On the computer, open **Settings > Android** in 1a2o. Enable the private-network connection if you are using the local Windows installation, then create a pairing link.
3. Scan the QR with your phone's camera to open the Android app. If the camera does not recognize app links, copy the pairing link and use **Paste pairing link** inside the app. You can also enter the displayed server address and one-time code separately.
4. Check the server address and tap **Connect**. Pairing signs this device into the existing account; you do not need to reconnect every mailbox or messaging platform.
5. Optionally enable background notifications. Android asks for permission, and an ongoing connection notification makes the background service visible. You can decline and enable it later from the connection menu.

The computer/server must remain online. On a private network, keep both devices on the same trusted Wi-Fi or private VPN. An ordinary public HTTPS installation can be reached away from home. `localhost` on an Android device means that device, not your computer. Pairing codes expire and are single-use; generate another if one no longer works.

## Everyday use

- The app remembers your connection and session across restarts. Tasks and Notes keep their browser-local copies in WebView storage as well as using the server's normal synchronization. Clearing app storage or uninstalling removes this device's local copies. The Android app pins Tasks/Notes static files in private application storage independently of the browser's evictable cache. After one successful connection to an updated server, **Local Tasks and Notes** in the connection menu and **Open local Tasks and Notes** on the retry screen open that workspace without the server. Pending edits remain local until a connection can sync them. Other features require the server.
- The connection menu contains reload, server details, notification controls, and **Pair again or change server**. A network failure shows a retry screen while retaining the saved connection.
- Android Back navigates within the workspace and exits full-screen media first.
- Files and photos use Android's document picker, including multiple selection. Downloads use the document picker to choose where to save them; generated browser files up to 32 MB are supported. Network downloads stream to the selected destination. Session cookies are never sent to a different download origin after redirects.
- Provider authorization and external websites open in your browser. Google sign-in is not embedded in a WebView. Add and authorize accounts on the computer if your local OAuth callbacks are configured for localhost.
- Background notifications use an optional foreground `remoteMessaging` service, not Firebase or a proprietary push account. It checks the paired server about every 30 seconds, backs off while offline, and consumes events without alerting while 1a2o is foregrounded. Android battery restrictions and server availability affect delivery. Tapping an alert returns to the existing app activity and opens the relevant tab. The ongoing Android notification has a Stop action.

## Build

Requires JDK 17, Gradle 8.11.1, Android platform 35 and build tools 35.0.0. Android Studio can open `apps/android` directly. The client uses the platform WebView and NanoHTTPD 2.3.1 for its loopback HTTP transport. There is no bundled JavaScript framework; application features are shared with the connected server.

```powershell
$env:JAVA_HOME = '<your JDK 17 directory>'
$env:ANDROID_HOME = '<your Android SDK directory>'
powershell -NoProfile -ExecutionPolicy Bypass -File ./apps/android/build.ps1
```

The script also recognizes private toolchains under `.context/android-tools/{jdk,gradle,sdk}`. It runs address validation tests, Android lint, and a debug APK build, then writes `.context/artifacts/1a2o-android.apk` and its SHA-256 hash. These artifacts and build tools are ignored by Git. The Android GitHub Actions workflow produces the same development APK as a downloadable artifact.

A debug APK is suitable for local testing. For a stable signed release, set `ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`, then run `powershell -NoProfile -ExecutionPolicy Bypass -File ./apps/android/build.ps1 -Release`. The script can also read local private signing configuration from `.context/android-signing/signing.json`. Keep the same signing key for updates and never commit it.

The relay is covered by JVM HTTP-contract checks (raw multipart bodies, header rewrites, cookie isolation, redirects, and security headers). Chromium verification confirms loopback OPFS, Workers, cryptography, UUIDs and secure-cookie-prefix round trips. A physical Android-device test is still recommended before a public production rollout.

The Android workflow signs release APKs when the repository has `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` secrets configured. Pull requests build development APKs without release credentials. A signed APK is directly installable; Play Store publication is a separate process.

## Security and privacy

- Pairing codes are not saved after exchange; the session is stored by Android's cookie manager. App backup/device transfer is disabled to avoid silently copying authenticated browser storage.
- The browser loads a loopback-only `http://127.0.0.1` transport so OPFS mail storage, Workers, SubtleCrypto and UUID APIs remain available even when the upstream server uses private-network HTTP. The listener binds only to `127.0.0.1`. Its port is stable per upstream server to preserve local storage; a conflicting saved port produces a retry message rather than silently changing the storage origin.
- Browser cookies are namespaced by upstream server, with only matching cookies restored for relay. Other localhost cookies are never forwarded. The relay never inserts native credentials into an unauthenticated request. Origins, referers and same-server redirects are mapped; upstream TLS certificates are still validated.
- HTTPS is the default. Explicit HTTP is accepted only for private IPv4/IPv6 or loopback addresses; use trusted networks. Redirects during pairing are rejected. Public HTTP servers and credentials embedded in URLs are refused.
- WebView local-file/content access is disabled, mixed content is blocked, and there is no injected native JavaScript object. Certificates are validated normally, including on private networks.
- The source contains no server address, OAuth secret, model API key or personal account. Android stores data locally and connects only to the user-selected server and normal links/integrations used by that server.

Implementation follows the [Android WebView APIs](https://developer.android.com/reference/android/webkit/WebView), [document chooser API](https://developer.android.com/reference/android/webkit/WebChromeClient#onShowFileChooser(android.webkit.WebView,%20android.webkit.ValueCallback%3Candroid.net.Uri[]%3E,%20android.webkit.WebChromeClient.FileChooserParams)), and [remote messaging foreground service type](https://developer.android.com/develop/background-work/services/fgs/service-types#remote-messaging). AGP 8.9 uses [Gradle 8.11.1 and JDK 17](https://developer.android.com/build/releases/agp-8-9-0-release-notes).
