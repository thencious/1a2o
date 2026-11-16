package app.oneatwoo;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.webkit.CookieManager;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/** Explicitly enabled desktop-to-phone message continuity; no third-party push server. */
public final class NotificationService extends Service {
    private static final String SERVICE_CHANNEL = "background-connection";
    private static final String ALERT_CHANNEL = "new-activity";
    private static final String STOP = "app.oneatwoo.STOP_NOTIFICATIONS";
    private static final int SERVICE_ID = 1001;
    private final ScheduledExecutorService worker = Executors.newSingleThreadScheduledExecutor();
    private SharedPreferences preferences;
    private NotificationManager notifications;
    private volatile boolean stopped;
    private boolean scheduled;
    private int failures;

    public static void start(Context context) {
        if (!context.getSharedPreferences("connection", MODE_PRIVATE).getBoolean("backgroundNotifications", false)) return;
        Intent intent = new Intent(context, NotificationService.class);
        if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent);
        else context.startService(intent);
    }

    public static void stop(Context context) {
        context.stopService(new Intent(context, NotificationService.class));
    }

    @Override public void onCreate() {
        super.onCreate();
        preferences = getSharedPreferences("connection", MODE_PRIVATE);
        notifications = getSystemService(NotificationManager.class);
        CookieManager.getInstance();
        NotificationChannel connection = new NotificationChannel(SERVICE_CHANNEL, "Background connection", NotificationManager.IMPORTANCE_LOW);
        connection.setDescription("Shown while the optional connection checks for new mail, messages, and reminders.");
        connection.setShowBadge(false);
        notifications.createNotificationChannel(connection);
        NotificationChannel activity = new NotificationChannel(ALERT_CHANNEL, "Mail, messages, and reminders", NotificationManager.IMPORTANCE_DEFAULT);
        activity.setDescription("New activity from your paired 1a2o server.");
        notifications.createNotificationChannel(activity);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if ((intent != null && STOP.equals(intent.getAction()))
                || !preferences.getBoolean("backgroundNotifications", false)
                || preferences.getString("server", "").isEmpty()
                || !permissionGranted()) {
            disable();
            return START_NOT_STICKY;
        }
        try {
            Notification ongoing = new Notification.Builder(this, SERVICE_CHANNEL)
                .setSmallIcon(android.R.drawable.ic_dialog_email)
                .setContentTitle("1a2o is connected")
                .setContentText("Checking for new mail, messages, and reminders")
                .setContentIntent(openApp("connection", preferences.getString("home", "/mail")))
                .setOngoing(true).setOnlyAlertOnce(true).setCategory(Notification.CATEGORY_SERVICE)
                .addAction(new Notification.Action.Builder(null, "Stop", PendingIntent.getService(this, 0,
                    new Intent(this, NotificationService.class).setAction(STOP), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE)).build())
                .build();
            if (Build.VERSION.SDK_INT >= 34) startForeground(SERVICE_ID, ongoing, ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING);
            else startForeground(SERVICE_ID, ongoing);
        } catch (RuntimeException error) {
            disable();
            return START_NOT_STICKY;
        }
        if (!scheduled) {
            scheduled = true;
            worker.execute(this::poll);
        }
        return START_STICKY;
    }

    private boolean permissionGranted() {
        return Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    private void poll() {
        if (stopped) return;
        long delay = 30;
        try {
            if (!preferences.getBoolean("backgroundNotifications", false) || !permissionGranted()) { disable(); return; }
            URI server = ServerAddress.parse(preferences.getString("server", ""));
            String origin = server.toString();
            String cursorKey = "notificationCursor:" + origin;
            String idsKey = "notificationIds:" + origin;
            long now = System.currentTimeMillis();
            long since = preferences.getLong(cursorKey, 0);
            if (since == 0) {
                // New opt-ins begin now instead of replaying existing unread conversations.
                since = now;
                preferences.edit().putLong(cursorKey, since).apply();
            }
            String cookies = CookieManager.getInstance().getCookie(origin);
            if (cookies == null || cookies.isEmpty()) { disable(); return; }
            URI endpoint = server.resolve("/api/mobile/notifications?since=" + since);
            if (!ServerAddress.sameOrigin(server, endpoint)) throw new IllegalStateException("Notification endpoint changed origin");
            JSONObject result = request(endpoint, cookies);
            if (result == null || stopped) return;
            Set<String> seen = readIds(preferences.getString(idsKey, "[]"));
            JSONArray items = result.optJSONArray("notifications");
            if (items != null) for (int i = 0; i < items.length(); i++) {
                JSONObject item = items.optJSONObject(i);
                if (item == null) continue;
                String id = item.optString("id", "");
                if (id.isEmpty() || id.length() > 512 || seen.contains(id)) continue;
                seen.add(id);
                if (!MainActivity.foreground && !stopped) show(item, id, server);
            }
            while (seen.size() > 256) seen.remove(seen.iterator().next());
            long through = result.optLong("through", since);
            // The server clock owns its cursor; never move it backwards on retries.
            through = Math.max(since, through);
            preferences.edit().putLong(cursorKey, through).putString(idsKey, new JSONArray(seen).toString()).apply();
            failures = 0;
        } catch (Exception error) {
            // A sleeping/offline host is normal. Avoid constant retries and leave sessions intact.
            failures = Math.min(failures + 1, 5);
            delay = Math.min(600, 30L << failures);
        } finally {
            if (!stopped) worker.schedule(this::poll, delay, TimeUnit.SECONDS);
        }
    }

    private JSONObject request(URI endpoint, String cookies) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) endpoint.toURL().openConnection();
        connection.setConnectTimeout(8_000);
        connection.setReadTimeout(15_000);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("Cookie", cookies);
        connection.setRequestProperty("User-Agent", "1a2o-Android/1.0");
        try {
            int status = connection.getResponseCode();
            if (status == 401 || status == 403) { disable(); return null; }
            if (status != 200) throw new IllegalStateException("Notifications unavailable");
            String type = connection.getContentType();
            if (type == null || !type.toLowerCase(java.util.Locale.ROOT).contains("application/json")) throw new IllegalStateException("Invalid notification response");
            try (InputStream input = connection.getInputStream(); ByteArrayOutputStream body = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if (body.size() + count > 1024 * 1024) throw new IllegalStateException("Notification response too large");
                    body.write(buffer, 0, count);
                }
                return new JSONObject(body.toString(StandardCharsets.UTF_8.name()));
            }
        } finally { connection.disconnect(); }
    }

    private void show(JSONObject item, String id, URI server) {
        String path = item.optString("path", preferences.getString("home", "/mail"));
        if (!safePath(path, server)) return;
        String title = item.optString("title", "New activity");
        String body = item.optString("body", "Open 1a2o to view it.");
        if (title.length() > 200) title = title.substring(0, 200);
        if (body.length() > 1000) body = body.substring(0, 1000);
        Notification alert = new Notification.Builder(this, ALERT_CHANNEL)
            .setSmallIcon(android.R.drawable.ic_dialog_email)
            .setContentTitle(title).setContentText(body)
            .setStyle(new Notification.BigTextStyle().bigText(body))
            .setContentIntent(openApp(id, path))
            .setAutoCancel(true).setOnlyAlertOnce(true)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setCategory(item.optString("tab").equals("messages") ? Notification.CATEGORY_MESSAGE : Notification.CATEGORY_EMAIL)
            .build();
        notifications.notify("activity:" + id, 1, alert);
    }

    private PendingIntent openApp(String id, String path) {
        Intent intent = new Intent(this, MainActivity.class).setAction("app.oneatwoo.OPEN")
            .setData(Uri.parse("onea2o://notification/" + Uri.encode(id)))
            .putExtra("path", path)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static boolean safePath(String path, URI server) {
        if (!path.startsWith("/") || path.startsWith("//") || path.contains("\\") || path.indexOf('\n') >= 0 || path.indexOf('\r') >= 0) return false;
        try { return ServerAddress.sameOrigin(server, server.resolve(path)); } catch (IllegalArgumentException error) { return false; }
    }

    private static Set<String> readIds(String stored) {
        LinkedHashSet<String> ids = new LinkedHashSet<>();
        try {
            JSONArray array = new JSONArray(stored);
            for (int i = Math.max(0, array.length() - 256); i < array.length(); i++) {
                String id = array.optString(i, "");
                if (!id.isEmpty()) ids.add(id);
            }
        } catch (Exception ignored) { /* Corrupt optional history must not stop delivery. */ }
        return ids;
    }

    private void disable() {
        preferences.edit().putBoolean("backgroundNotifications", false).apply();
        stopped = true;
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override public void onDestroy() {
        stopped = true;
        worker.shutdownNow();
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
