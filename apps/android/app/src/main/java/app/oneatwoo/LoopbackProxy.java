package app.oneatwoo;

import fi.iki.elonen.NanoHTTPD;
import java.io.ByteArrayInputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.PrintWriter;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.Consumer;

/** Browser localhost remains a trustworthy origin without exposing a listener to the LAN. */
public final class LoopbackProxy extends NanoHTTPD {
    private final URI upstream;
    private final Consumer<List<String>> cookieObserver;
    private final String cookiePrefix;
    private final long maxBody=128L*1024*1024;
    public LoopbackProxy(URI server,int port,Consumer<List<String>> observer) {
        super("127.0.0.1",port);upstream=server;cookieObserver=observer;
        try{byte[] hash=java.security.MessageDigest.getInstance("SHA-256").digest(server.toString().getBytes(StandardCharsets.UTF_8));StringBuilder text=new StringBuilder("onea2o_");for(int i=0;i<8;i++)text.append(String.format(Locale.ROOT,"%02x",hash[i]));cookiePrefix=text+"_";}catch(Exception error){throw new IllegalStateException(error);}
    }
    public URI origin(){return URI.create("http://127.0.0.1:"+getListeningPort());}
    @Override protected boolean useGzipWhenAccepted(Response response){return false;}
    @Override public Response serve(IHTTPSession session) {
        HttpURLConnection connection=null;
        try {
            Map<String,String> headers=session.getHeaders();
            if(!origin().getRawAuthority().equalsIgnoreCase(headers.get("host")))return error(400,"Invalid local host");
            String path=new URI(null,null,session.getUri(),null).toASCIIString();
            String query=session.getQueryParameterString();
            URI target=upstream.resolve(path+(query==null?"":"?"+query));
            if(!ServerAddress.sameOrigin(upstream,target))return error(400,"Invalid server path");
            if(headers.containsKey("transfer-encoding"))return error(411,"A content length is required");
            long length=Long.parseLong(headers.getOrDefault("content-length","0"));
            if(length<0||length>maxBody)return error(413,"Request is too large");
            connection=(HttpURLConnection)target.toURL().openConnection();
            connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(12000);connection.setReadTimeout(180000);
            connection.setRequestMethod(session.getMethod().name());
            for(Map.Entry<String,String> header:headers.entrySet()){
                String name=header.getKey().toLowerCase(Locale.ROOT),value=header.getValue();
                if(hopHeader(name)||name.equals("host")||name.equals("content-length")||name.equals("accept-encoding")||name.equals("remote-addr")||name.equals("http-client-ip"))continue;
                if(name.equals("cookie")){value=upstreamCookies(value);if(value.isEmpty())continue;}
                if(name.equals("origin")&&value.equals(origin().toString()))value=upstream.toString();
                if(name.equals("referer"))value=mapOrigin(value,origin(),upstream);
                connection.setRequestProperty(name,value);
            }
            connection.setRequestProperty("Accept-Encoding","identity");
            if(length>0||session.getMethod()==Method.POST||session.getMethod()==Method.PUT||session.getMethod()==Method.PATCH){
                connection.setDoOutput(true);connection.setFixedLengthStreamingMode(length);
                try(OutputStream output=connection.getOutputStream()){
                    InputStream input=session.getInputStream();byte[] buffer=new byte[65536];long remaining=length;
                    while(remaining>0){int size=input.read(buffer,0,(int)Math.min(buffer.length,remaining));if(size<0)throw new IOException("Request body ended early");output.write(buffer,0,size);remaining-=size;}
                }
            }
            final HttpURLConnection active=connection;
            int status=active.getResponseCode();
            InputStream responseBody=status>=400?active.getErrorStream():active.getInputStream();
            if(responseBody==null)responseBody=new ByteArrayInputStream(new byte[0]);
            InputStream stream=new FilterInputStream(responseBody){@Override public void close() throws IOException{try{super.close();}finally{active.disconnect();}}};
            List<String> cookies=new ArrayList<>();
            RelayResponse response=new RelayResponse(status,active.getContentType(),stream,active.getContentLengthLong(),cookies);
            response.setGzipEncoding(false);
            for(Map.Entry<String,List<String>> header:active.getHeaderFields().entrySet()){
                if(header.getKey()==null)continue;
                String name=header.getKey(),lower=name.toLowerCase(Locale.ROOT);
                if(hopHeader(lower)||lower.equals("content-length")||lower.equals("content-type"))continue;
                for(String original:header.getValue()){
                    String value=original;
                    if(lower.equals("set-cookie")){cookies.add(localCookie(value));continue;}
                    if(lower.equals("location"))value=mapOrigin(value,upstream,origin());
                    response.addHeader(name,value);
                }
            }
            if(!cookies.isEmpty()){
                response.addHeader("X-1a2o-Relay-Cookies", "present");
                if(cookieObserver!=null){List<String> originals=active.getHeaderFields().entrySet().stream().filter(e->e.getKey()!=null&&e.getKey().equalsIgnoreCase("Set-Cookie")).flatMap(e->e.getValue().stream()).collect(java.util.stream.Collectors.toList());cookieObserver.accept(originals);}
            }
            connection=null;
            return response;
        }catch(Exception failure){return error(502,"The 1a2o server is unavailable. Check the connection and try again.");}
        finally{if(connection!=null)connection.disconnect();}
    }
    public String localCookie(String value){
        return cookiePrefix+value.replaceAll("(?i);\\s*domain=[^;]*","").replaceAll("(?i);\\s*secure\\s*(?=;|$)","").replaceAll("(?i);\\s*samesite=none", "; SameSite=Lax");
    }
    public String upstreamCookies(String value){
        List<String> result=new ArrayList<>();
        for(String part:value.split(";")){String cookie=part.trim();int separator=cookie.indexOf('=');if(separator>cookiePrefix.length()&&cookie.startsWith(cookiePrefix))result.add(cookie.substring(cookiePrefix.length()));}
        return String.join("; ",result);
    }
    public static String mapOrigin(String value,URI from,URI to){
        try{URI uri=new URI(value);if(uri.isAbsolute()&&ServerAddress.sameOrigin(from,uri))return to.resolve(uri.getRawPath()+(uri.getRawQuery()==null?"":"?"+uri.getRawQuery())+(uri.getRawFragment()==null?"":"#"+uri.getRawFragment())).toString();}
        catch(Exception ignored){}
        return value;
    }
    private static boolean hopHeader(String name){return name.equals("connection")||name.equals("keep-alive")||name.equals("proxy-authenticate")||name.equals("proxy-authorization")||name.equals("te")||name.equals("trailer")||name.equals("transfer-encoding")||name.equals("upgrade");}
    private static Response error(int code,String message){return newFixedLengthResponse(status(code),"text/plain; charset=utf-8",message);}
    private static Response.IStatus status(int code){return new Response.IStatus(){public int getRequestStatus(){return code;}public String getDescription(){return code+" Relay";}};}
    private static final class RelayResponse extends Response {
        private final List<String> cookies;
        RelayResponse(int code,String type,InputStream input,long length,List<String> values){super(status(code),type,input,length);cookies=values;setChunkedTransfer(length<0);}
        @Override protected void printHeader(PrintWriter writer,String key,String value){if(key.equals("X-1a2o-Relay-Cookies")){for(String cookie:cookies)super.printHeader(writer,"Set-Cookie",cookie);}else super.printHeader(writer,key,value);}
    }
}
