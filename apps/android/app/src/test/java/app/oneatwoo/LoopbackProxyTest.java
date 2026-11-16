package app.oneatwoo;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

public final class LoopbackProxyTest {
    public static void main(String[] args) throws Exception {
        HttpServer backend=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        URI upstream=URI.create("http://127.0.0.1:"+backend.getAddress().getPort());
        AtomicReference<byte[]> received=new AtomicReference<>();
        AtomicReference<com.sun.net.httpserver.Headers> headers=new AtomicReference<>();
        backend.createContext("/", exchange->{
            received.set(exchange.getRequestBody().readAllBytes());headers.set(exchange.getRequestHeaders());
            byte[] body="<html><body>1a2o transport test</body></html>".getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type","text/html; charset=utf-8");
            exchange.getResponseHeaders().set("Cross-Origin-Opener-Policy","same-origin");
            exchange.getResponseHeaders().set("Cross-Origin-Embedder-Policy","require-corp");
            String path=exchange.getRequestURI().getPath();
            if(path.equals("/redirect")){exchange.getResponseHeaders().set("Location",upstream+"/destination?q=unchanged%2Bvalue");exchange.sendResponseHeaders(302,-1);exchange.close();return;}
            if(path.equals("/echo-cookie")){body=String.valueOf(exchange.getRequestHeaders().getFirst("Cookie")).getBytes(StandardCharsets.UTF_8);}
            if(path.equals("/cookies")){
                exchange.getResponseHeaders().add("Set-Cookie","__Secure-onea2o=secure-test; Path=/; Secure; HttpOnly; Domain=127.0.0.1");
                exchange.getResponseHeaders().add("Set-Cookie","plain=second-cookie; Path=/; HttpOnly");
            }
            exchange.sendResponseHeaders(200,body.length);exchange.getResponseBody().write(body);exchange.close();
        });
        backend.start();
        LoopbackProxy proxy=new LoopbackProxy(upstream,0,null);proxy.start(10000,true);
        try {
            if(args.length>0&&args[0].equals("serve")){System.out.println(proxy.origin());System.out.flush();System.in.read();return;}
            HttpClient client=HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).build();
            URI local=proxy.origin();
            byte[] body="--boundary\r\nContent-Disposition: form-data; name=\"message\"\r\n\r\nquote: \"clean\"\u0000\u00ff\r\n--boundary--\r\n".getBytes(StandardCharsets.UTF_8);
            HttpResponse<byte[]> response=client.send(HttpRequest.newBuilder(local.resolve("/echo?chatId=a%2Bb"))
                .header("Content-Type","multipart/form-data; boundary=boundary").header("Cookie",proxy.localCookie("session=explicit-browser-cookie")+"; unrelated-localhost=must-not-leak")
                .header("Origin",local.toString()).header("Referer",local+"/mail?q=test")
                .POST(HttpRequest.BodyPublishers.ofByteArray(body)).build(),HttpResponse.BodyHandlers.ofByteArray());
            check(response.statusCode()==200,"POST status");check(Arrays.equals(received.get(),body),"Raw binary/multipart body changed");
            check(headers.get().getFirst("Cookie").equals("session=explicit-browser-cookie"),"Browser cookie changed");
            check(headers.get().getFirst("Origin").equals(upstream.toString()),"Origin not rewritten");
            check(headers.get().getFirst("Referer").equals(upstream+"/mail?q=test"),"Referer not rewritten");
            client.send(HttpRequest.newBuilder(local.resolve("/" )).GET().build(),HttpResponse.BodyHandlers.discarding());
            check(headers.get().getFirst("Cookie")==null,"Native credentials were injected into unauthenticated loopback request");
            LoopbackProxy other=new LoopbackProxy(URI.create("https://different-server.example"),0,null);
            check(proxy.upstreamCookies(other.localCookie("session=foreign-server-secret")).isEmpty(),"A different server's cookie was forwarded");
            response=client.send(HttpRequest.newBuilder(local.resolve("/redirect")).GET().build(),HttpResponse.BodyHandlers.ofByteArray());
            check(response.statusCode()==302,"Redirect followed rather than relayed");
            check(response.headers().firstValue("Location").orElse("").equals(local+"/destination?q=unchanged%2Bvalue"),"Location mapping changed path/query");
            response=client.send(HttpRequest.newBuilder(local.resolve("/cookies")).GET().build(),HttpResponse.BodyHandlers.ofByteArray());
            List<String> cookies=response.headers().allValues("Set-Cookie");check(cookies.size()==2,"Multiple Set-Cookie headers lost");check(cookies.stream().noneMatch(v->v.toLowerCase().contains("domain=")),"Cookie domain not removed");
            check(cookies.stream().allMatch(v->v.startsWith("onea2o_")),"Cookies not isolated by backend");
            check(proxy.upstreamCookies(String.join("; ", cookies).replaceAll("; Path=/", "").replaceAll("; HttpOnly", "")).contains("__Secure-onea2o=secure-test"),"Secure-prefix cookie name not restored");
            check(LoopbackProxy.mapOrigin("https://external.example/path",upstream,local).equals("https://external.example/path"),"External URL rewritten");
            check(response.headers().firstValue("Cross-Origin-Embedder-Policy").orElse("").equals("require-corp"),"Isolation headers dropped");
            System.out.println("PASS: loopback parser, raw body, explicit-cookie isolation, Origin/Referer rewrite, redirects, multi-cookie headers and isolation headers");
        }finally{proxy.stop();backend.stop(0);}
    }
    private static void check(boolean condition,String message){if(!condition)throw new AssertionError(message);}
}
