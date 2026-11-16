package app.oneatwoo;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.SslErrorHandler;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import org.json.JSONObject;
import org.json.JSONTokener;
import android.util.Base64;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    public static volatile boolean foreground;
    private static final int BACKGROUND = Color.rgb(23,23,23), PANEL = Color.rgb(39,39,39), TEXT = Color.rgb(229,229,229), MUTED = Color.rgb(163,163,163);
    private static final int FILE_REQUEST = 41, DOWNLOAD_REQUEST = 42;
    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private SharedPreferences preferences;
    private LinearLayout page;
    private FrameLayout content;
    private WebView web;
    private View errorOverlay, fullscreen;
    private WebChromeClient.CustomViewCallback fullscreenCallback;
    private ProgressBar progress;
    private EditText serverField, codeField;
    private TextView setupStatus;
    private Button connectButton, testButton;
    private URI server;
    private URI browserOrigin;
    private LoopbackProxy relay;
    private static LoopbackProxy processRelay;
    private static String processRelayServer;
    private String pendingSessionCookie;
    private WebView workspaceWarmup;
    private String homePath = "/mail";
    private boolean connecting;
    private WorkspaceCache workspaceCache;
    private boolean localWorkspace;
    private ValueCallback<Uri[]> filesCallback;
    private String downloadUrl, downloadCookies, downloadAgent, downloadMime, downloadName;
    private byte[] generatedDownload;
    private boolean downloading;
    private int blobWaits;


    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        preferences = getSharedPreferences("connection", MODE_PRIVATE);
        getWindow().setStatusBarColor(BACKGROUND);
        getWindow().setNavigationBarColor(BACKGROUND);
        WebView.setWebContentsDebuggingEnabled(false);
        Uri link = getIntent().getData();
        if (isPairingLink(link)) { showSetup(link); return; }
        String saved = preferences.getString("server", "");
        if (!saved.isEmpty()) {
            try {
                server = ServerAddress.parse(saved);
                homePath = safePath(preferences.getString("home", "/mail"));
                showApp(state);
                return;
            } catch (IllegalArgumentException ignored) { preferences.edit().clear().apply(); }
        }
        showSetup(null);
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent); setIntent(intent);
        if (isPairingLink(intent.getData())) {showSetup(intent.getData());return;}
        if(intent.getData()!=null&&"mailto".equalsIgnoreCase(intent.getData().getScheme())&&web!=null){web.loadUrl(browserOrigin.resolve(composePath(intent.getData())).toString());return;}
        String path=intent.getStringExtra("path");
        if(path!=null&&web!=null)web.loadUrl(browserOrigin.resolve(safePath(path)).toString());
    }

    private void newPage() {
        page = new LinearLayout(this); page.setOrientation(LinearLayout.VERTICAL); page.setBackgroundColor(BACKGROUND);
        page.setOnApplyWindowInsetsListener((view,insets)->{
            if(Build.VERSION.SDK_INT>=30){
                android.graphics.Insets edges=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout());
                view.setPadding(edges.left,edges.top,edges.right,edges.bottom);
            } else view.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());
            return insets;
        });
        setContentView(page);
    }

    private void showSetup(Uri pairingLink) {
        if (web != null) { web.destroy(); web = null; }
        if(workspaceWarmup!=null){workspaceWarmup.destroy();workspaceWarmup=null;}
        newPage();
        ScrollView scroll = new ScrollView(this); scroll.setFillViewport(true);
        LinearLayout body = new LinearLayout(this); body.setOrientation(LinearLayout.VERTICAL); body.setPadding(dp(28),dp(34),dp(28),dp(28));
        scroll.addView(body, new ScrollView.LayoutParams(-1,-2)); page.addView(scroll,new LinearLayout.LayoutParams(-1,-1));
        ImageView icon = new ImageView(this); icon.setImageResource(app.oneatwoo.R.mipmap.ic_launcher);
        LinearLayout.LayoutParams iconSize = new LinearLayout.LayoutParams(dp(64),dp(64)); iconSize.bottomMargin=dp(22); body.addView(icon,iconSize);
        body.addView(text("Your workspace, on Android",26,TEXT));
        addText(body,"Connect to your existing 1a2o installation. Your accounts and data stay together; you do not need to sign in to each service again.",15,MUTED,12);
        LinearLayout steps = card();
        addText(steps,"1  Open 1a2o on your computer",16,TEXT,0);
        addText(steps,"2  Go to Settings \u2192 Android and create a pairing link",16,TEXT,15);
        addText(steps,"3  Scan the QR with your phone camera, or paste the link below",16,TEXT,15);
        LinearLayout.LayoutParams stepSize=new LinearLayout.LayoutParams(-1,-2);stepSize.topMargin=dp(24);stepSize.bottomMargin=dp(20);body.addView(steps,stepSize);
        Button paste=button("Paste pairing link");paste.setOnClickListener(view->pasteLink());body.addView(paste);
        addText(body,"Server address",13,MUTED,22);
        serverField=input("https://your-server.example",false);serverField.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_URI);
        serverField.setText(preferences.getString("server",""));body.addView(serverField);
        addText(body,"Use the address shown on your computer. localhost on your phone refers to this phone, not your computer.",12,MUTED,8);
        addText(body,"One-time pairing code",13,MUTED,18);
        codeField=input("Paste the code from 1a2o",true);body.addView(codeField);
        LinearLayout actions=new LinearLayout(this);actions.setOrientation(LinearLayout.HORIZONTAL);
        testButton=button("Test connection");connectButton=button("Connect");
        LinearLayout.LayoutParams half=new LinearLayout.LayoutParams(0,dp(52),1);half.setMargins(0,dp(18),dp(8),0);actions.addView(testButton,half);
        LinearLayout.LayoutParams halfRight=new LinearLayout.LayoutParams(0,dp(52),1);halfRight.topMargin=dp(18);actions.addView(connectButton,halfRight);body.addView(actions);
        testButton.setOnClickListener(view->connect(false));connectButton.setOnClickListener(view->connect(true));
        setupStatus=text("",14,MUTED);LinearLayout.LayoutParams statusSize=new LinearLayout.LayoutParams(-1,-2);statusSize.topMargin=dp(16);body.addView(setupStatus,statusSize);
        addText(body,"Your computer or server must stay online. For a private-network address, use trusted Wi-Fi or a private VPN. HTTPS is recommended outside your home network.",12,MUTED,18);
        if (pairingLink != null) applyLink(pairingLink);
    }

    private void pasteLink() {
        ClipboardManager clipboard=(ClipboardManager)getSystemService(CLIPBOARD_SERVICE);
        ClipData value=clipboard.getPrimaryClip();
        if(value==null || value.getItemCount()==0){setupStatus.setText("Copy a pairing link from Settings \u2192 Android first.");return;}
        CharSequence raw=value.getItemAt(0).coerceToText(this);
        Uri link=Uri.parse(raw==null?"":raw.toString().trim());
        if(!isPairingLink(link)){setupStatus.setText("That is not a 1a2o pairing link. You can also enter the server address and code separately.");return;}
        applyLink(link);
    }

    private void applyLink(Uri link) {
        String address=link.getQueryParameter("server"),code=link.getQueryParameter("code");
        if(address!=null)serverField.setText(address);
        if(code!=null)codeField.setText(code);
        setupStatus.setText("Pairing details are ready. Check the server address, then tap Connect.");
    }

    private static boolean isPairingLink(Uri link) {return link!=null&&"onea2o".equals(link.getScheme())&&"pair".equals(link.getHost());}

    private void connect(boolean pair) {
        if(connecting)return;
        final URI chosen;
        try {chosen=ServerAddress.parse(serverField.getText().toString());}
        catch(IllegalArgumentException error){setupStatus.setText(error.getMessage());return;}
        final String code=codeField.getText().toString().trim();
        if(pair&&code.isEmpty()){setupStatus.setText("Create a pairing code in Settings \u2192 Android on your computer, then paste it here.");codeField.requestFocus();return;}
        connecting=true;connectButton.setEnabled(false);testButton.setEnabled(false);setupStatus.setText(pair?"Connecting securely to your workspace\u2026":"Checking your server\u2026");
        network.execute(()->{
            try {
                JSONObject status=request(chosen,"/api/mobile/pair/status",null);
                if(!"1a2o".equals(status.optString("app")))throw new Exception("This address is not a compatible 1a2o server. Update your computer installation and try again.");
                if(!pair){runOnUiThread(()->setupStatus.setText("Server found. Enter your pairing code and tap Connect."));return;}
                JSONObject body=new JSONObject().put("code",code).put("deviceName",Build.MANUFACTURER+" "+Build.MODEL);
                JSONObject result=request(chosen,"/api/mobile/pair/exchange",body);
                String cookie=result.optString("cookie");
                if(cookie.isEmpty()||cookie.length()>32768||cookie.contains("\r")||cookie.contains("\n"))throw new Exception("The server did not return a valid session. Create a new pairing code.");
                String path=safePath(result.optString("redirectPath","/mail"));
                runOnUiThread(()->{
                    CookieManager cookies=CookieManager.getInstance();cookies.setAcceptCookie(true);
                    cookies.setCookie(chosen.toString(),cookie,accepted->{
                        if(!accepted){setupStatus.setText("Android could not save the connection. Check the server's HTTPS and cookie configuration.");return;}
                        cookies.flush();server=chosen;homePath=path;pendingSessionCookie=cookie;
                        preferences.edit().putString("server",server.toString()).putString("home",homePath).apply();codeField.setText("");showApp(null);offerNotifications();
                    });
                });
            } catch(Exception error) {
                String message=error.getMessage();
                if(error instanceof java.net.ConnectException||error instanceof java.net.SocketTimeoutException||error instanceof java.net.UnknownHostException)
                    message="Cannot reach your server. Keep 1a2o open on the computer, check the address, and use the same Wi-Fi or private VPN.";
                if(error instanceof javax.net.ssl.SSLException)message="The server's HTTPS certificate could not be verified. Use a valid certificate; 1a2o does not bypass certificate checks.";
                final String explanation=message==null?"Connection failed. Please try again.":message;
                runOnUiThread(()->setupStatus.setText(explanation));
            } finally {runOnUiThread(()->{connecting=false;connectButton.setEnabled(true);testButton.setEnabled(true);});}
        });
    }

    private JSONObject request(URI origin,String path,JSONObject body) throws Exception {
        HttpURLConnection connection=(HttpURLConnection)origin.resolve(path).toURL().openConnection();
        connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(12000);connection.setReadTimeout(20000);
        connection.setRequestProperty("Accept","application/json");connection.setRequestProperty("User-Agent","1a2o-Android/1.0");
        try {
            if(body!=null){connection.setRequestMethod("POST");connection.setDoOutput(true);connection.setRequestProperty("Content-Type","application/json");try(OutputStream output=connection.getOutputStream()){output.write(body.toString().getBytes(StandardCharsets.UTF_8));}}
            int code=connection.getResponseCode();
            InputStream stream=code>=200&&code<300?connection.getInputStream():connection.getErrorStream();
            if(stream==null)throw new Exception("The server returned HTTP "+code+". Check its address and update 1a2o.");
            byte[] bytes;
            try(InputStream input=stream;ByteArrayOutputStream buffer=new ByteArrayOutputStream()){
                byte[] chunk=new byte[4096];int size;
                while((size=input.read(chunk))!=-1){buffer.write(chunk,0,size);if(buffer.size()>65536)break;}
                bytes=buffer.toByteArray();
            }
            if(bytes.length>65536)throw new Exception("The server returned an unexpected response.");
            JSONObject data;
            try {data=new JSONObject(new String(bytes,StandardCharsets.UTF_8));}catch(Exception error){throw new Exception("This address did not return a 1a2o connection response. Check the port and server address.");}
            if(code<200||code>=300)throw new Exception(data.optString("error","Pairing failed. Create a new code and try again."));
            return data;
        } finally {connection.disconnect();}
    }

    @SuppressWarnings("SetJavaScriptEnabled")
    private void showApp(Bundle savedState) {
        try {startTransport();}catch(Exception error){showSetup(null);setupStatus.setText("The local browser connection could not start. Its saved port may be in use. Restart this device and try again.");return;}
        newPage();
        LinearLayout bar=new LinearLayout(this);bar.setGravity(Gravity.CENTER_VERTICAL);bar.setPadding(dp(12),0,dp(8),0);
        TextView title=text("1a2o",16,TEXT);bar.addView(title,new LinearLayout.LayoutParams(0,dp(40),1));title.setGravity(Gravity.CENTER_VERTICAL);
        Button menu=button("\u22ee");menu.setContentDescription("Connection options");bar.addView(menu,new LinearLayout.LayoutParams(dp(42),dp(40)));menu.setOnClickListener(this::showMenu);
        page.addView(bar,new LinearLayout.LayoutParams(-1,dp(40)));
        progress=new ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal);progress.setMax(100);page.addView(progress,new LinearLayout.LayoutParams(-1,dp(3)));
        content=new FrameLayout(this);page.addView(content,new LinearLayout.LayoutParams(-1,0,1));
        web=new WebView(this);web.setBackgroundColor(BACKGROUND);content.addView(web,new FrameLayout.LayoutParams(-1,-1));
        WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);settings.setUserAgentString(settings.getUserAgentString()+" 1a2o-Android/1.0");
        settings.setSupportMultipleWindows(true);settings.setJavaScriptCanOpenWindowsAutomatically(false);
        CookieManager.getInstance().setAcceptCookie(true);CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
        workspaceCache=new WorkspaceCache(this,server,CookieManager.getInstance().getCookie(server.toString()));
        network.execute(workspaceCache::preload);
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
                Uri target=request.getUrl();
                if(sameServer(target))return false;
                if(backendUrl(target)){view.loadUrl(LoopbackProxy.mapOrigin(target.toString(),server,browserOrigin));return true;}
                if(request.isForMainFrame())openExternal(target);
                return request.isForMainFrame();
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                Uri target=request.getUrl();
                Uri cachedTarget=Uri.parse(LoopbackProxy.mapOrigin(target.toString(),browserOrigin,server));
                WebResourceResponse workspace=workspaceCache.resource(cachedTarget,localWorkspace);
                if(workspace!=null)return workspace;
                // Cleartext is permitted only for the explicitly paired private-network origin.
                if("http".equalsIgnoreCase(target.getScheme())&&!sameServer(target))return new WebResourceResponse("text/plain","UTF-8",403,"Blocked",java.util.Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));
                return null;
            }
            @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap icon){hideError();progress.setVisibility(View.VISIBLE);}
            @Override public void onPageFinished(WebView view,String url){CookieManager.getInstance().flush();progress.setVisibility(View.GONE);}
            @Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError error){if(request.isForMainFrame())showError("Your workspace is unavailable","Keep your server online and check your network. Your saved connection is still here.");}
            @Override public void onReceivedHttpError(WebView view,WebResourceRequest request,WebResourceResponse response){if(request.isForMainFrame()&&response.getStatusCode()>=500)showError("The server needs a moment","Try again shortly, or check 1a2o on your computer.");}
            @Override public void onReceivedSslError(WebView view,SslErrorHandler handler,SslError error){handler.cancel();showError("HTTPS certificate could not be verified","Check your server's certificate. Certificate errors are never bypassed.");}
        });
        web.setWebChromeClient(new WebChromeClient(){
            @Override public void onProgressChanged(WebView view,int value){progress.setProgress(value);progress.setVisibility(value==100?View.GONE:View.VISIBLE);}
            @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){
                if(filesCallback!=null)filesCallback.onReceiveValue(null);filesCallback=callback;
                Intent choose=new Intent(Intent.ACTION_OPEN_DOCUMENT);choose.addCategory(Intent.CATEGORY_OPENABLE);choose.setType("*/*");choose.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,params.getMode()==FileChooserParams.MODE_OPEN_MULTIPLE);
                String[] types=params.getAcceptTypes();if(types.length>0&&!types[0].isEmpty())choose.putExtra(Intent.EXTRA_MIME_TYPES,types);
                try{startActivityForResult(choose,FILE_REQUEST);}catch(ActivityNotFoundException error){filesCallback.onReceiveValue(null);filesCallback=null;Toast.makeText(MainActivity.this,"No file picker is available on this device.",Toast.LENGTH_LONG).show();}
                return true;
            }
            @Override public boolean onCreateWindow(WebView view,boolean dialog,boolean userGesture,android.os.Message result){
                if(!userGesture)return false;
                WebView popup=new WebView(MainActivity.this);
                popup.setWebViewClient(new WebViewClient(){@Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest request){Uri uri=request.getUrl();if(sameServer(uri))web.loadUrl(uri.toString());else openExternal(uri);popup.destroy();return true;}});
                ((WebView.WebViewTransport)result.obj).setWebView(popup);result.sendToTarget();return true;
            }
            @Override public void onShowCustomView(View view,CustomViewCallback callback){if(fullscreen!=null){callback.onCustomViewHidden();return;}fullscreen=view;fullscreenCallback=callback;content.addView(view,new FrameLayout.LayoutParams(-1,-1));}
            @Override public void onHideCustomView(){closeFullscreen();}
        });
        web.setDownloadListener((url,agent,disposition,mime,length)->download(url,agent,disposition,mime));
        Runnable load=()->{
            String notificationPath=getIntent().getStringExtra("path");
            if(getIntent().getData()!=null&&"mailto".equalsIgnoreCase(getIntent().getData().getScheme()))web.loadUrl(browserOrigin.resolve(composePath(getIntent().getData())).toString());
            else if(notificationPath!=null){web.loadUrl(browserOrigin.resolve(safePath(notificationPath)).toString());getIntent().removeExtra("path");}
            else if(savedState==null||web.restoreState(savedState)==null)web.loadUrl(browserOrigin.resolve(homePath).toString());
            warmWorkspace();
        };
        if(pendingSessionCookie!=null){String value=pendingSessionCookie;pendingSessionCookie=null;CookieManager.getInstance().setCookie(browserOrigin.toString(),relay.localCookie(value),accepted->{CookieManager.getInstance().flush();if(accepted)load.run();else showError("Could not save the device session","Check the server cookie configuration and pair again.");});}
        else load.run();
    }

    private void startTransport() throws Exception {
        synchronized(MainActivity.class){
            if(processRelay!=null&&server.toString().equals(processRelayServer)&&processRelay.isAlive()){relay=processRelay;browserOrigin=relay.origin();return;}
            if(processRelay!=null)processRelay.stop();
            String key="loopbackPort:"+server;
            int port=preferences.getInt(key,0);
            final URI chosenServer=server;
            final android.os.Handler cookieHandler=new android.os.Handler(android.os.Looper.getMainLooper());
            relay=new LoopbackProxy(chosenServer,port,cookies->cookieHandler.post(()->{for(String cookie:cookies)CookieManager.getInstance().setCookie(chosenServer.toString(),cookie);CookieManager.getInstance().flush();}));
            relay.start(10000,true);browserOrigin=relay.origin();
            preferences.edit().putInt(key,relay.getListeningPort()).apply();
            processRelay=relay;processRelayServer=server.toString();
        }
    }
    @SuppressWarnings("SetJavaScriptEnabled")
    private void warmWorkspace() {
        if(workspaceWarmup!=null)workspaceWarmup.destroy();
        workspaceWarmup=new WebView(this);
        workspaceWarmup.getSettings().setJavaScriptEnabled(true);workspaceWarmup.getSettings().setDomStorageEnabled(true);
        workspaceWarmup.getSettings().setAllowFileAccess(false);workspaceWarmup.getSettings().setAllowContentAccess(false);
        workspaceWarmup.getSettings().setUserAgentString(workspaceWarmup.getSettings().getUserAgentString()+" 1a2o-Android/1.0");
        workspaceWarmup.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){return !sameServer(request.getUrl());}
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){return workspaceCache.resource(Uri.parse(LoopbackProxy.mapOrigin(request.getUrl().toString(),browserOrigin,server)),false);}
        });
        workspaceWarmup.setAlpha(0);workspaceWarmup.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
        content.addView(workspaceWarmup,0,new FrameLayout.LayoutParams(1,1));
        workspaceWarmup.loadUrl(browserOrigin.resolve("/open-todo-zero/offline.html").toString());
    }

    private void showMenu(View anchor) {
        PopupMenu menu=new PopupMenu(this,anchor);
        menu.getMenu().add("Reload").setOnMenuItemClickListener(item->{localWorkspace=false;web.loadUrl(browserOrigin.resolve(homePath).toString());return true;});
        menu.getMenu().add("Local Tasks and Notes").setOnMenuItemClickListener(item->{openLocalWorkspace();return true;});
        menu.getMenu().add("Connection details").setOnMenuItemClickListener(item->{new AlertDialog.Builder(this).setTitle("Connected to 1a2o").setMessage(server+"\n\nYour server keeps your accounts and data. Keep it online to sync this device.").setPositiveButton("OK",null).show();return true;});
        menu.getMenu().add(preferences.getBoolean("backgroundNotifications",false)?"Turn off background notifications":"Enable background notifications").setOnMenuItemClickListener(item->{
            if(preferences.getBoolean("backgroundNotifications",false)){preferences.edit().putBoolean("backgroundNotifications",false).apply();NotificationService.stop(this);}
            else offerNotifications();return true;
        });
        menu.getMenu().add("Open-source licenses").setOnMenuItemClickListener(item->{
            try(InputStream input=getAssets().open("third_party_notices.txt");ByteArrayOutputStream output=new ByteArrayOutputStream()){
                byte[] bytes=new byte[4096];int count;while((count=input.read(bytes))!=-1)output.write(bytes,0,count);
                new AlertDialog.Builder(this).setTitle("Open-source licenses").setMessage(new String(output.toByteArray(),StandardCharsets.UTF_8)).setPositiveButton("OK",null).show();
            }catch(Exception ignored){}return true;
        });
        menu.getMenu().add("Pair again or change server").setOnMenuItemClickListener(item->{new AlertDialog.Builder(this).setTitle("Change connection?").setMessage("You will need a new pairing code from Settings \u2192 Android. Your server's data and this device's local Tasks and Notes will stay intact. Sync any pending changes before switching accounts.").setNegativeButton("Cancel",null).setPositiveButton("Continue",(dialog,which)->{NotificationService.stop(this);preferences.edit().putBoolean("backgroundNotifications",false).apply();CookieManager.getInstance().removeAllCookies(ignored->{CookieManager.getInstance().flush();showSetup(null);});}).show();return true;});
        menu.show();
    }

    private void offerNotifications() {
        new AlertDialog.Builder(this).setTitle("Keep up with new messages?")
            .setMessage("1a2o can check your server for new mail, messages, and task reminders while this app is closed. Android will show an ongoing connection notification. This uses some battery and needs your server to stay online.")
            .setNegativeButton("Not now",null).setPositiveButton("Enable",(dialog,which)->{
                if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},43);
                else enableNotifications();
            }).show();
    }
    private void enableNotifications() {preferences.edit().putBoolean("backgroundNotifications",true).apply();NotificationService.start(this);}
    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] grants){super.onRequestPermissionsResult(request,permissions,grants);if(request==43&&grants.length>0&&grants[0]==PackageManager.PERMISSION_GRANTED)enableNotifications();}

    private void download(String url,String userAgent,String disposition,String mime) {
        if(downloading){Toast.makeText(this,"Another download is in progress.",Toast.LENGTH_SHORT).show();return;}
        Uri target=Uri.parse(url);
        downloadName=URLUtil.guessFileName(url,disposition,mime);downloadMime=mime==null?"application/octet-stream":mime;
        if("blob".equals(target.getScheme())) {
            if(!sameServer(Uri.parse(url.substring(5))))return;
            downloading=true;generatedDownload=null;blobWaits=0;
            String script="window.__onea2oFile=null;fetch("+JSONObject.quote(url)+").then(r=>r.blob()).then(b=>{if(b.size>33554432)throw Error('This generated file is larger than 32 MB.');const r=new FileReader();r.onload=()=>{window.__onea2oFile={data:r.result.split(',')[1],type:b.type}};r.onerror=()=>{window.__onea2oFile={error:'Could not read file'}};r.readAsDataURL(b)}).catch(e=>{window.__onea2oFile={error:e.message}});";
            web.evaluateJavascript(script,null);pollGeneratedFile();return;
        }
        if(!"https".equals(target.getScheme())&&!("http".equals(target.getScheme())&&sameServer(target)))return;
        downloading=true;downloadUrl=url;downloadAgent=userAgent;generatedDownload=null;
        downloadCookies=(sameServer(target)||backendUrl(target))?CookieManager.getInstance().getCookie(target.toString()):null;
        chooseDownloadDestination();
    }

    private void pollGeneratedFile() {
        if(web==null||!sameServer(Uri.parse(web.getUrl()==null?"":web.getUrl()))){downloading=false;return;}
        web.evaluateJavascript("window.__onea2oFile?JSON.stringify({ready:true,length:window.__onea2oFile.data?.length||0,error:window.__onea2oFile.error,type:window.__onea2oFile.type}):null",value->{
            try {
                Object raw=new JSONTokener(value).nextValue();
                if(raw==JSONObject.NULL){if(++blobWaits>200)throw new Exception("Preparing the download timed out.");web.postDelayed(this::pollGeneratedFile,100);return;}
                JSONObject state=new JSONObject((String)raw);
                if(state.has("error"))throw new Exception(state.getString("error"));
                downloadMime=state.optString("type",downloadMime);
                ByteArrayOutputStream data=new ByteArrayOutputStream();
                readGeneratedChunk(data,0,state.getInt("length"));
            } catch(Exception error){downloading=false;Toast.makeText(this,error.getMessage(),Toast.LENGTH_LONG).show();}
        });
    }

    private void readGeneratedChunk(ByteArrayOutputStream output,int offset,int length) {
        if(web==null||!sameServer(Uri.parse(web.getUrl()==null?"":web.getUrl()))){downloading=false;return;}
        int end=Math.min(offset+65536,length);
        web.evaluateJavascript("window.__onea2oFile.data.slice("+offset+","+end+")",value->{
            try {
                String chunk=(String)new JSONTokener(value).nextValue();
                output.write(Base64.decode(chunk,Base64.DEFAULT));
                if(end<length){readGeneratedChunk(output,end,length);return;}
                generatedDownload=output.toByteArray();web.evaluateJavascript("delete window.__onea2oFile",null);chooseDownloadDestination();
            } catch(Exception error){downloading=false;Toast.makeText(this,"Could not prepare this download.",Toast.LENGTH_LONG).show();}
        });
    }

    private void chooseDownloadDestination() {
        Intent save=new Intent(Intent.ACTION_CREATE_DOCUMENT);save.addCategory(Intent.CATEGORY_OPENABLE);
        save.setType(downloadMime);save.putExtra(Intent.EXTRA_TITLE,downloadName);
        try{startActivityForResult(save,DOWNLOAD_REQUEST);}catch(ActivityNotFoundException error){downloading=false;Toast.makeText(this,"No file picker is available to save this file.",Toast.LENGTH_LONG).show();}
    }

    private void saveDownload(Uri destination) {
        Toast.makeText(this,"Saving download\u2026",Toast.LENGTH_SHORT).show();
        final byte[] generated=generatedDownload;
        final String source=downloadUrl,cookies=downloadCookies,agent=downloadAgent;
        final URI cookieOrigin=source==null?null:URI.create(source);
        network.execute(()->{
            try(OutputStream output=getContentResolver().openOutputStream(destination)) {
                if(output==null)throw new Exception();
                if(generated!=null)output.write(generated);
                else {
                    URI address=new URI(source);
                    for(int redirects=0;redirects<6;redirects++) {
                        if(!address.getScheme().equalsIgnoreCase("https")&&!(address.getScheme().equalsIgnoreCase("http")&&(ServerAddress.sameOrigin(server,address)||ServerAddress.sameOrigin(browserOrigin,address))))throw new Exception();
                        HttpURLConnection connection=(HttpURLConnection)address.toURL().openConnection();
                        connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(15000);connection.setReadTimeout(30000);
                        if(agent!=null)connection.setRequestProperty("User-Agent",agent);
                        if(cookies!=null&&cookieOrigin!=null&&ServerAddress.sameOrigin(cookieOrigin,address))connection.setRequestProperty("Cookie",cookies);
                        try {
                            int status=connection.getResponseCode();
                            if(status>=300&&status<400){String location=connection.getHeaderField("Location");if(location==null)throw new Exception();address=address.resolve(location);continue;}
                            if(status<200||status>=300)throw new Exception();
                            try(InputStream input=connection.getInputStream()){byte[] buffer=new byte[65536];int count;while((count=input.read(buffer))!=-1)output.write(buffer,0,count);}
                            runOnUiThread(()->Toast.makeText(this,"File saved",Toast.LENGTH_SHORT).show());return;
                        } finally {connection.disconnect();}
                    }
                    throw new Exception();
                }
                runOnUiThread(()->Toast.makeText(this,"File saved",Toast.LENGTH_SHORT).show());
            } catch(Exception error){runOnUiThread(()->Toast.makeText(this,"The download could not be completed. Please try again.",Toast.LENGTH_LONG).show());}
            finally {generatedDownload=null;downloading=false;}
        });
    }

    private String composePath(Uri mailto) {
        return Uri.parse(homePath).buildUpon().appendQueryParameter("mailto",mailto.toString()).appendQueryParameter("compose-request",java.util.UUID.randomUUID().toString()).build().toString();
    }
    private void openExternal(Uri uri) {
        String scheme=uri.getScheme();
        if("mailto".equalsIgnoreCase(scheme)&&web!=null){web.loadUrl(browserOrigin.resolve(composePath(uri)).toString());return;}
        if(!"https".equalsIgnoreCase(scheme)&&!"http".equalsIgnoreCase(scheme)&&!"mailto".equalsIgnoreCase(scheme)&&!"tel".equalsIgnoreCase(scheme))return;
        try{startActivity(new Intent(Intent.ACTION_VIEW,uri));}catch(ActivityNotFoundException error){Toast.makeText(this,"No app can open this link.",Toast.LENGTH_SHORT).show();}
    }
    private boolean sameServer(Uri uri) {try{return browserOrigin!=null&&ServerAddress.sameOrigin(browserOrigin,new URI(uri.toString()));}catch(Exception error){return false;}}
    private boolean backendUrl(Uri uri) {try{return server!=null&&ServerAddress.sameOrigin(server,new URI(uri.toString()));}catch(Exception error){return false;}}
    private static String safePath(String path) {return path!=null&&path.startsWith("/")&&!path.startsWith("//")&&!path.contains("\\")?path:"/mail";}
    private void showError(String title,String detail) {
        if(errorOverlay!=null)return;
        LinearLayout box=new LinearLayout(this);box.setOrientation(LinearLayout.VERTICAL);box.setGravity(Gravity.CENTER);box.setPadding(dp(28),dp(28),dp(28),dp(28));box.setBackgroundColor(BACKGROUND);
        box.addView(text(title,22,TEXT));addText(box,detail,15,MUTED,16);
        Button retry=button("Try again");retry.setOnClickListener(v->{hideError();web.reload();});LinearLayout.LayoutParams params=new LinearLayout.LayoutParams(-1,dp(52));params.topMargin=dp(24);box.addView(retry,params);
        if(workspaceCache!=null&&workspaceCache.hasOfflineHome()){
            Button offline=button("Open local Tasks and Notes");offline.setOnClickListener(v->openLocalWorkspace());box.addView(offline,new LinearLayout.LayoutParams(-1,dp(52)));
        }
        Button setup=button("Connection settings");setup.setOnClickListener(v->showSetup(null));box.addView(setup,new LinearLayout.LayoutParams(-1,dp(52)));
        errorOverlay=box;content.addView(box,new FrameLayout.LayoutParams(-1,-1));progress.setVisibility(View.GONE);
    }
    private void openLocalWorkspace() {
        try{
            if(workspaceCache==null||!workspaceCache.hasOfflineHome()){
                Toast.makeText(this,"Connect to the updated server once to save the offline workspace on this device.",Toast.LENGTH_LONG).show();return;
            }
            hideError();localWorkspace=true;
            web.loadDataWithBaseURL(browserOrigin.resolve("/open-todo-zero/offline.html").toString(),workspaceCache.offlineHome(),"text/html","UTF-8",null);
        }catch(Exception error){Toast.makeText(this,"Could not open the local workspace. Reconnect once to refresh its files.",Toast.LENGTH_LONG).show();}
    }
    private void hideError(){if(errorOverlay!=null&&content!=null){content.removeView(errorOverlay);errorOverlay=null;}}
    private void closeFullscreen(){if(fullscreen!=null){content.removeView(fullscreen);fullscreen=null;if(fullscreenCallback!=null)fullscreenCallback.onCustomViewHidden();fullscreenCallback=null;}}
    @Override public void onBackPressed(){if(fullscreen!=null){closeFullscreen();return;}if(errorOverlay!=null){hideError();return;}if(web!=null&&web.canGoBack()){web.goBack();return;}super.onBackPressed();}
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request==DOWNLOAD_REQUEST){if(result==RESULT_OK&&data!=null&&data.getData()!=null)saveDownload(data.getData());else {downloading=false;generatedDownload=null;}return;}if(request==FILE_REQUEST&&filesCallback!=null){ArrayList<Uri> selected=new ArrayList<>();if(result==RESULT_OK&&data!=null){if(data.getClipData()!=null)for(int i=0;i<data.getClipData().getItemCount();i++)selected.add(data.getClipData().getItemAt(i).getUri());else if(data.getData()!=null)selected.add(data.getData());}filesCallback.onReceiveValue(selected.isEmpty()?null:selected.toArray(new Uri[0]));filesCallback=null;}}
    @Override protected void onSaveInstanceState(Bundle state){super.onSaveInstanceState(state);if(web!=null)web.saveState(state);}
    @Override protected void onPause(){super.onPause();if(web!=null)web.onPause();CookieManager.getInstance().flush();}
    @Override protected void onResume(){super.onResume();foreground=true;if(web!=null)web.onResume();if(preferences.getBoolean("backgroundNotifications",false)&&server!=null)NotificationService.start(this);}
    @Override protected void onStop(){foreground=false;super.onStop();}
    @Override protected void onDestroy(){if(filesCallback!=null)filesCallback.onReceiveValue(null);if(web!=null)web.destroy();if(workspaceWarmup!=null)workspaceWarmup.destroy();network.shutdownNow();super.onDestroy();}
    private TextView text(String value,int size,int color){TextView view=new TextView(this);view.setText(value);view.setTextSize(size);view.setTextColor(color);view.setLineSpacing(dp(3),1);return view;}
    private void addText(LinearLayout parent,String value,int size,int color,int margin){TextView view=text(value,size,color);LinearLayout.LayoutParams params=new LinearLayout.LayoutParams(-1,-2);params.topMargin=dp(margin);parent.addView(view,params);}
    private LinearLayout card(){LinearLayout view=new LinearLayout(this);view.setOrientation(LinearLayout.VERTICAL);view.setPadding(dp(18),dp(18),dp(18),dp(18));view.setBackgroundColor(PANEL);return view;}
    private Button button(String label){Button view=new Button(this);view.setText(label);view.setTextColor(TEXT);view.setAllCaps(false);view.setTextSize(14);view.setMinHeight(dp(44));return view;}
    private EditText input(String hint,boolean secret){EditText view=new EditText(this);view.setSingleLine(true);view.setTextColor(TEXT);view.setHintTextColor(MUTED);view.setHint(hint);view.setTextSize(15);view.setPadding(dp(12),dp(12),dp(12),dp(12));view.setInputType(InputType.TYPE_CLASS_TEXT|(secret?InputType.TYPE_TEXT_VARIATION_PASSWORD:InputType.TYPE_TEXT_VARIATION_URI));return view;}
    private int dp(int value){return Math.round(value*getResources().getDisplayMetrics().density);}
}
