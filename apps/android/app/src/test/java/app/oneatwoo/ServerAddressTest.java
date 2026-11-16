package app.oneatwoo;

public final class ServerAddressTest {
    public static void main(String[] args) {
        expect("https://example.org", "example.org");
        expect("http://192.168.1.12:3012", "http://192.168.1.12:3012/");
        expect("http://10.0.2.2:3012", "http://10.0.2.2:3012");
        expect("http://100.101.102.103:3012", "http://100.101.102.103:3012");
        reject("http://100.128.0.1");
        reject("http://example.org"); reject("https://user:pass@example.org"); reject("https://example.org/mail");
        reject("https://example.org?token=x"); reject("https://example.org#fragment"); reject("javascript:alert(1)");
        reject("http://172.32.0.1"); reject("http://192.168.1.999"); reject("http://127.0.0.1.evil.example");
        if (!ServerAddress.sameOrigin(ServerAddress.parse("https://example.org"), java.net.URI.create("https://example.org:443/mail"))) throw new AssertionError();
        if (ServerAddress.sameOrigin(ServerAddress.parse("https://example.org"), java.net.URI.create("https://example.org.evil.example/mail"))) throw new AssertionError();
        System.out.println("PASS: server address validation, private LAN exception, and strict origin matching");
    }
    private static void expect(String output, String input) { if (!ServerAddress.parse(input).toString().equals(output)) throw new AssertionError(input); }
    private static void reject(String input) { try { ServerAddress.parse(input); throw new AssertionError(input); } catch (IllegalArgumentException expected) {} }
}
