package app.oneatwoo;

import java.net.URI;
import java.util.Locale;

/** Validates the user-chosen first-party server before any credential is sent. */
public final class ServerAddress {
    private ServerAddress() {}
    public static URI parse(String input) {
        String text = input.trim();
        if (!text.contains("://")) text = "https://" + text;
        try {
            URI uri = new URI(text);
            String scheme = uri.getScheme().toLowerCase(Locale.ROOT);
            String host = uri.getHost();
            if (host == null || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null
                || (uri.getRawPath() != null && !uri.getRawPath().isEmpty() && !uri.getRawPath().equals("/"))
                || uri.getPort() == 0 || uri.getPort() > 65535) throw new IllegalArgumentException();
            if (!scheme.equals("https") && !(scheme.equals("http") && isPrivateHost(host))) throw new IllegalArgumentException();
            return new URI(scheme, null, host.toLowerCase(Locale.ROOT), uri.getPort(), null, null, null);
        } catch (Exception error) {
            throw new IllegalArgumentException("Enter an HTTPS server address, or an http:// private network address. Do not include a page path.");
        }
    }
    public static boolean sameOrigin(URI server, URI target) {
        return server.getScheme().equalsIgnoreCase(target.getScheme()) && server.getHost().equalsIgnoreCase(target.getHost() == null ? "" : target.getHost()) && port(server) == port(target);
    }
    public static boolean isPrivateHost(String host) {
        String value = host.toLowerCase(Locale.ROOT).replace("[", "").replace("]", "");
        if (value.equals("localhost") || value.equals("::1")) return true;
        if (value.contains(":")) return value.matches("f[cd][0-9a-f]{2}:.*") || value.matches("fe[89ab][0-9a-f]:.*");
        String[] parts = value.split("\\.");
        if (parts.length != 4) return false;
        int[] ip = new int[4];
        for (int i=0; i<4; i++) {
            if (!parts[i].matches("0|[1-9][0-9]{0,2}")) return false;
            ip[i] = Integer.parseInt(parts[i]);
            if (ip[i] > 255) return false;
        }
        return ip[0] == 10 || ip[0] == 127 || (ip[0] == 100 && ip[1] >= 64 && ip[1] <= 127) || (ip[0] == 172 && ip[1] >= 16 && ip[1] <= 31) || (ip[0] == 192 && ip[1] == 168) || (ip[0] == 169 && ip[1] == 254);
    }
    private static int port(URI uri) { return uri.getPort() != -1 ? uri.getPort() : uri.getScheme().equalsIgnoreCase("https") ? 443 : 80; }
}
