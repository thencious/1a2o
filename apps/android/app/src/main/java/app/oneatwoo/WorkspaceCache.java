package app.oneatwoo;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebResourceResponse;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.Locale;

/** A durable app-private copy, independent of the browser's evictable cache. */
public final class WorkspaceCache {
    private final File directory;
    private final URI origin;
    private final String cookie;
    public WorkspaceCache(Context context,URI server,String cookies) {
        origin=server;cookie=cookies;
        directory=new File(context.getFilesDir(),"workspace-offline/"+hash(server.toString()));
        directory.mkdirs();
    }
    public boolean hasOfflineHome(){return file("/open-todo-zero/offline.html").isFile();}
    public String offlineHome() throws Exception{return new String(Files.readAllBytes(file("/open-todo-zero/offline.html").toPath()),StandardCharsets.UTF_8);}
    public WebResourceResponse resource(Uri target,boolean preferOffline) {
        try {
            URI url=new URI(target.toString());
            String path=url.getPath();
            if(!ServerAddress.sameOrigin(origin,url)||path==null||!path.startsWith("/open-todo-zero/"))return null;
            File cached=file(path);
            byte[] bytes;
            if(preferOffline&&cached.isFile())bytes=Files.readAllBytes(cached.toPath());
            else try {bytes=download(path);save(path,bytes);}catch(Exception error){if(!cached.isFile())return null;bytes=Files.readAllBytes(cached.toPath());}
            return new WebResourceResponse(mime(path),"UTF-8",new ByteArrayInputStream(bytes));
        } catch(Exception error){return null;}
    }
    public void preload() {
        try {
            byte[] manifest=download("/open-todo-zero/offline-assets.json");
            JSONArray assets=new JSONObject(new String(manifest,StandardCharsets.UTF_8)).getJSONArray("assets");
            if(assets.length()>256)return;
            for(int i=0;i<assets.length();i++) {
                String path=assets.getString(i);
                if(!path.startsWith("/open-todo-zero/")||path.contains("\\")||path.contains("..")||path.length()>1024)continue;
                try{save(new URI(path).getPath(),download(path));}catch(Exception ignored){}
            }
            save("/open-todo-zero/offline-assets.json",manifest);
        }catch(Exception ignored){/* Previously pinned files remain available while the server is offline. */}
    }
    private byte[] download(String path) throws Exception {
        URI address=origin.resolve(path);
        if(!ServerAddress.sameOrigin(origin,address))throw new IllegalArgumentException();
        HttpURLConnection connection=(HttpURLConnection)address.toURL().openConnection();
        connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(1500);connection.setReadTimeout(4000);
        if(cookie!=null)connection.setRequestProperty("Cookie",cookie);
        try {
            if(connection.getResponseCode()!=200)throw new Exception();
            try(InputStream input=connection.getInputStream();ByteArrayOutputStream output=new ByteArrayOutputStream()){
                byte[] chunk=new byte[65536];int count;
                while((count=input.read(chunk))!=-1){output.write(chunk,0,count);if(output.size()>12*1024*1024)throw new Exception();}
                return output.toByteArray();
            }
        }finally{connection.disconnect();}
    }
    private File file(String path){return new File(directory,hash(path));}
    private void save(String path,byte[] bytes) throws Exception {
        File target=file(path),temporary=File.createTempFile("asset-",".tmp",directory);
        try{Files.write(temporary.toPath(),bytes);Files.move(temporary.toPath(),target.toPath(),StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);}
        finally{if(temporary.exists())temporary.delete();}
    }
    private static String hash(String value){
        try{byte[] bytes=MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));StringBuilder text=new StringBuilder();for(byte b:bytes)text.append(String.format(Locale.ROOT,"%02x",b));return text.toString();}
        catch(Exception error){throw new IllegalStateException(error);}
    }
    private static String mime(String path){
        if(path.endsWith(".html"))return "text/html";
        if(path.endsWith(".css"))return "text/css";
        if(path.endsWith(".js")||path.endsWith(".mjs"))return "application/javascript";
        if(path.endsWith(".json"))return "application/json";
        if(path.endsWith(".svg"))return "image/svg+xml";
        if(path.endsWith(".png"))return "image/png";
        if(path.endsWith(".woff2"))return "font/woff2";
        return "application/octet-stream";
    }
}
